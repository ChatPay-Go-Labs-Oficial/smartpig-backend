import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlindPayKycStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { BlindPayService } from '../blindpay/blindpay.service';
import type {
  BlindPayRfi,
  BlindPayKycStatusValue,
} from '../blindpay/dto/blindpay.dto';
import { CreateReceiverDto } from './dto/ramp.dto';
import { validateRfiResponse } from './rfi-validation';
import { stellarNetwork } from './ramp-network';

/** Statuses em que existe um RFI aberto para o customer. */
const RFI_STATUSES: BlindPayKycStatus[] = [
  BlindPayKycStatus.COMPLIANCE_REQUEST,
  BlindPayKycStatus.APPROVED_RFI,
];

const STATUS_MAP: Record<BlindPayKycStatusValue, BlindPayKycStatus> = {
  verifying: BlindPayKycStatus.VERIFYING,
  approved: BlindPayKycStatus.APPROVED,
  rejected: BlindPayKycStatus.REJECTED,
  compliance_request: BlindPayKycStatus.COMPLIANCE_REQUEST,
  approved_rfi: BlindPayKycStatus.APPROVED_RFI,
};

export interface KycStatusResult {
  kycStatus: BlindPayKycStatus;
  rejectionReason: string | null;
  warnings: unknown;
  rfi: BlindPayRfi | null;
  /** `true` só quando a rejeição admite uma nova tentativa do usuário. */
  canResubmit: boolean;
  updatedAt: Date;
}

/**
 * Tudo que envolve o ciclo de vida do KYC BlindPay: consultar o status real,
 * responder RFI e refazer o KYC depois de uma rejeição.
 *
 * Vive separado do `RampService` porque a BlindPay trata rejeição e RFI como
 * caminhos distintos — RFI se resolve no customer existente, rejeição exige um
 * customer novo — e essa assimetria já é lógica suficiente para um serviço.
 */
@Injectable()
export class RampKycService {
  private readonly logger = new Logger(RampKycService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blindpay: BlindPayService,
    private readonly config: ConfigService,
  ) {}

  // ─── Status ────────────────────────────────────────────────────────────────

  /**
   * Busca o status na BlindPay, persiste e devolve — junto do RFI aberto,
   * quando houver. É o endpoint que o app faz poll enquanto o KYC não fecha.
   */
  async getKycStatus(userId: string): Promise<KycStatusResult> {
    const receiver = await this.prisma.blindPayReceiver.findUnique({
      where: { userId },
    });
    if (!receiver) {
      throw new NotFoundException('Receiver not found for this user');
    }

    const remote = await this.blindpay.getReceiver(receiver.blindpayReceiverId);
    const kycStatus = this.mapStatus(remote.kyc_status);
    const warnings = remote.kyc_warnings ?? remote.fraud_warnings ?? null;
    const rejectionReason =
      kycStatus === BlindPayKycStatus.REJECTED
        ? this.extractReason(remote.kyc_warnings ?? remote.fraud_warnings)
        : null;

    const updated = await this.persistStatus(receiver.id, userId, {
      kycStatus,
      warnings,
      rejectionReason,
    });

    // Só vale gastar a chamada extra quando o status indica RFI aberto.
    const rfi = RFI_STATUSES.includes(kycStatus)
      ? await this.blindpay.getRfi(receiver.blindpayReceiverId)
      : null;

    return {
      kycStatus,
      rejectionReason,
      warnings,
      rfi,
      canResubmit: kycStatus === BlindPayKycStatus.REJECTED,
      updatedAt: updated.kycUpdatedAt ?? updated.updatedAt,
    };
  }

  /**
   * Grava o status e, quando aprovado, marca o usuário como onboarded.
   *
   * `isOnboarded` só é ligado aqui — nunca desligado. Rebaixar a flag quebraria
   * usuários que chegaram ao app por outro caminho de onboarding; o gate de
   * ramp usa `kycStatus`, que é a fonte de verdade para a BlindPay.
   */
  private async persistStatus(
    receiverId: string,
    userId: string,
    data: {
      kycStatus: BlindPayKycStatus;
      warnings: unknown;
      rejectionReason: string | null;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const receiver = await tx.blindPayReceiver.update({
        where: { id: receiverId },
        data: {
          kycStatus: data.kycStatus,
          kycWarnings: data.warnings ?? Prisma.DbNull,
          rejectionReason: data.rejectionReason,
          kycUpdatedAt: new Date(),
        },
      });

      if (data.kycStatus === BlindPayKycStatus.APPROVED) {
        await tx.user.update({
          where: { id: userId },
          data: { isOnboarded: true },
        });
      }

      return receiver;
    });
  }

  /** Aplica ao banco um `kyc_status` vindo do webhook, achando o receiver pelo id da BlindPay. */
  async applyWebhookStatus(
    blindpayReceiverId: string,
    rawStatus: string | undefined,
    warnings: unknown,
  ): Promise<void> {
    const receiver = await this.prisma.blindPayReceiver.findUnique({
      where: { blindpayReceiverId },
      select: { id: true, userId: true },
    });
    if (!receiver) {
      // Customer criado fora do app, ou já arquivado por um reenvio. Nada a fazer.
      this.logger.warn(
        `Webhook customer.* para receiver desconhecido: ${blindpayReceiverId}`,
      );
      return;
    }

    const kycStatus = this.mapStatus(rawStatus);
    await this.persistStatus(receiver.id, receiver.userId, {
      kycStatus,
      warnings,
      rejectionReason:
        kycStatus === BlindPayKycStatus.REJECTED
          ? this.extractReason(warnings)
          : null,
    });
  }

  // ─── Reenvio após rejeição ─────────────────────────────────────────────────

  /**
   * Refaz o KYC criando um customer BlindPay novo.
   *
   * A doc é explícita: não dá para corrigir o KYC de um customer existente. Por
   * isso a conta Pix e a blockchain wallet também precisam ser recriadas — elas
   * ficam presas ao customer antigo. O usuário não redigita nada: reaproveitamos
   * a chave Pix e o endereço Stellar já salvos.
   */
  async resubmitReceiver(dto: CreateReceiverDto) {
    const receiver = await this.prisma.blindPayReceiver.findUnique({
      where: { userId: dto.userId },
      include: { bankAccounts: true, blockchainWallets: true },
    });
    if (!receiver) {
      throw new NotFoundException('Receiver not found — create it first');
    }
    if (receiver.kycStatus !== BlindPayKycStatus.REJECTED) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'KYC_NOT_REJECTED',
        message:
          'O reenvio de KYC só é permitido depois de uma rejeição. Consulte o status atual.',
      });
    }

    // Um `tos_id` só pode ser vinculado a UM customer ("can only ever be linked
    // to one customer"), e o reenvio cria um customer novo — o do cadastro
    // anterior já está queimado. Sem aceitação nova não há o que enviar.
    if (!dto.tosId) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'TOS_REQUIRED',
        message:
          'É necessário aceitar os Termos de Uso novamente antes de reenviar o KYC.',
      });
    }

    const name =
      [dto.firstName, dto.lastName].filter(Boolean).join(' ') || receiver.name;

    const created = await this.blindpay.createReceiver({
      type: dto.type ?? 'individual',
      kyc_type: dto.kycType ?? 'standard',
      email: dto.email,
      country: dto.country ?? 'BR',
      first_name: dto.firstName,
      last_name: dto.lastName,
      tax_id: dto.taxId,
      address_line_1: dto.addressLine1,
      address_line_2: dto.addressLine2,
      city: dto.city,
      state_province_region: dto.stateProvinceRegion,
      postal_code: dto.postalCode,
      date_of_birth: dto.dateOfBirth,
      id_doc_country: dto.idDocCountry,
      id_doc_type: dto.idDocType,
      selfie_file: dto.selfieFileUrl,
      id_doc_front_file: dto.idDocFrontUrl,
      id_doc_back_file: dto.idDocBackUrl,
      tos_id: dto.tosId,
    });

    // As chamadas de rede acontecem antes da transação: o Prisma não pode
    // segurar uma transação aberta esperando HTTP externo.
    const network = stellarNetwork(this.config);
    const rebuiltAccounts = await Promise.all(
      receiver.bankAccounts.map(async (account) => ({
        localId: account.id,
        remoteId: (
          await this.blindpay.createBankAccount(created.id, {
            type: 'pix',
            name,
            pix_key: account.pixKey ?? undefined,
          })
        ).id,
      })),
    );
    const rebuiltWallets = await Promise.all(
      receiver.blockchainWallets.map(async (wallet) => ({
        localId: wallet.id,
        remoteId: (
          await this.blindpay.createBlockchainWallet(created.id, {
            name: `Stellar wallet for ${name}`,
            network,
            address: wallet.address,
          })
        ).id,
      })),
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.blindPayKycAttempt.create({
        data: {
          receiverId: receiver.id,
          blindpayReceiverId: receiver.blindpayReceiverId,
          kycStatus: receiver.kycStatus,
          rejectionReason: receiver.rejectionReason,
          warnings: (receiver.kycWarnings ??
            Prisma.DbNull) as Prisma.InputJsonValue,
        },
      });

      const updated = await tx.blindPayReceiver.update({
        where: { id: receiver.id },
        data: {
          blindpayReceiverId: created.id,
          name,
          taxId: dto.taxId ?? receiver.taxId,
          tosId: dto.tosId,
          kycStatus: BlindPayKycStatus.VERIFYING,
          kycWarnings: Prisma.DbNull,
          rejectionReason: null,
          kycUpdatedAt: new Date(),
        },
      });

      for (const account of rebuiltAccounts) {
        await tx.blindPayBankAccount.update({
          where: { id: account.localId },
          data: { blindpayBankAccountId: account.remoteId },
        });
      }
      for (const wallet of rebuiltWallets) {
        await tx.blindPayBlockchainWallet.update({
          where: { id: wallet.localId },
          data: { blindpayWalletId: wallet.remoteId },
        });
      }

      return updated;
    });
  }

  // ─── RFI ───────────────────────────────────────────────────────────────────

  async getRfi(userId: string): Promise<BlindPayRfi | null> {
    const receiver = await this.requireReceiver(userId);
    return this.blindpay.getRfi(receiver.blindpayReceiverId);
  }

  /**
   * Valida a resposta contra os campos pedidos e envia. Em sucesso a BlindPay
   * devolve o customer para `verifying`, então espelhamos isso localmente em vez
   * de esperar o próximo poll.
   */
  async submitRfi(userId: string, responses: Record<string, unknown>) {
    const receiver = await this.requireReceiver(userId);

    const rfi = await this.blindpay.getRfi(receiver.blindpayReceiverId);
    if (!rfi) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'RFI_NOT_FOUND',
        message: 'Não há solicitação de informações pendente.',
      });
    }
    if (rfi.status !== 'pending') {
      throw new BadRequestException({
        statusCode: 400,
        code: 'RFI_NOT_PENDING',
        message: `Esta solicitação já está com status "${rfi.status}" e não aceita mais respostas.`,
      });
    }

    const { fields, body } = validateRfiResponse(rfi, responses);
    if (Object.keys(fields).length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'RFI_INVALID',
        message: 'Revise os campos destacados antes de enviar.',
        fields,
      });
    }

    const result = await this.blindpay.submitRfi(
      receiver.blindpayReceiverId,
      body,
    );

    await this.prisma.blindPayReceiver.update({
      where: { id: receiver.id },
      data: {
        kycStatus: BlindPayKycStatus.VERIFYING,
        rejectionReason: null,
        kycUpdatedAt: new Date(),
      },
    });

    return result;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async requireReceiver(userId: string) {
    const receiver = await this.prisma.blindPayReceiver.findUnique({
      where: { userId },
    });
    if (!receiver) {
      throw new NotFoundException('Receiver not found for this user');
    }
    return receiver;
  }

  private mapStatus(raw: string | null | undefined): BlindPayKycStatus {
    const mapped = STATUS_MAP[raw as BlindPayKycStatusValue];
    if (mapped) return mapped;
    // Status novo ou ausente: tratar como "ainda em análise" é o único default
    // seguro — nunca aprova nem rejeita por engano.
    this.logger.warn(
      `kyc_status desconhecido da BlindPay: ${String(raw)} — assumindo VERIFYING`,
    );
    return BlindPayKycStatus.VERIFYING;
  }

  /**
   * Achata `kyc_warnings` numa frase exibível.
   *
   * O formato não é documentado — já vimos array de strings e array de objetos.
   * Cobrimos os dois e caímos para `null` no resto, deixando o app usar a copy
   * genérica em vez de imprimir `[object Object]`.
   */
  private extractReason(warnings: unknown): string | null {
    const pick = (entry: unknown): string | null => {
      if (typeof entry === 'string') return entry.trim() || null;
      if (!entry || typeof entry !== 'object') return null;
      const record = entry as Record<string, unknown>;
      for (const key of ['message', 'reason', 'description', 'detail']) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      return null;
    };

    const list = Array.isArray(warnings) ? warnings : [warnings];
    const messages = list
      .map(pick)
      .filter((message): message is string => message !== null);

    return messages.length > 0 ? messages.join(' ') : null;
  }
}
