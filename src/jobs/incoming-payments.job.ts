import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  EtherfuseOrderDirection,
  EtherfuseOrderStatus,
  RampStatus,
} from '@prisma/client';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { PrismaService } from '../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  HorizonPaymentsClient,
  type HorizonPayment,
} from './horizon-payments.client';

/** Página do Horizon (máximo 200; 50 cobre folgado um minuto de carteira). */
const PAGE_SIZE = 50;
/** Páginas por carteira por execução. O resto fica para a próxima. */
const MAX_PAGES_PER_WALLET = 3;
/**
 * Carteiras por execução. O Horizon público da SDF limita ~3600 requisições
 * por hora por IP; 50 por minuto (mais as páginas extras) fica abaixo disso.
 */
const DEFAULT_WALLETS_PER_RUN = 50;
/**
 * Abaixo disso não vira push: qualquer conta pode mandar USDC para qualquer
 * outra, e poeira seria um jeito barato de inundar o usuário de notificações.
 */
const MIN_NOTIFY_AMOUNT = 0.01;
/** Onramp em andamento criado até 72 h antes do pagamento. */
const ONRAMP_OPEN_WINDOW_MS = 72 * 60 * 60_000;
/** Onramp concluído até 2 h antes do pagamento (o webhook pode chegar antes). */
const ONRAMP_COMPLETED_WINDOW_MS = 2 * 60 * 60_000;

interface WatchedWallet {
  id: string;
  userId: string;
  stellarAddress: string;
  lastPaymentCursor: string | null;
}

interface PigfiSender {
  userId: string;
  username: string | null;
}

/**
 * Watcher de transferências recebidas (TRANSFER_RECEIVED).
 *
 * MVP: polling de `/accounts/:id/payments` a cada minuto, em rodízio pelas
 * carteiras ativas, com cursor por carteira (`lastPaymentCursor`). Se a base
 * crescer, trocar por stream SSE do Horizon ou por um indexador; o cursor e a
 * dedupeKey (`payment:<id>`) continuam valendo.
 *
 * O endereço é `WalletAccount.stellarAddress`, o mesmo que o app manda no
 * login (`walletLogin(address)`) e usa em `listUsdcTransfers` para o
 * histórico. O filtro também é o do app: `type === 'payment'` e USDC por
 * code+issuer. Com isso ficam de fora operações de cofre (invoke_host_function),
 * conversões (path_payment_*) e create_account.
 *
 * Duplicata com pushes que já existem:
 * - Remetentes do sistema são ignorados: o emissor do USDC, a tesouraria e o
 *   agente de presentes. O resgate de presente é um `claim_claimable_balance`
 *   seguido de um `payment` do agente para o destinatário, na mesma transação,
 *   então o filtro por tipo sozinho não basta.
 * - Entrega de onramp: nem OnrampTransaction nem EtherfuseOrder guardam hash ou
 *   endereço de origem, e não há config com as contas dos parceiros. Por isso,
 *   pagamento de remetente que não é PigFi, para um usuário com onramp em
 *   andamento (ou concluído há pouco), é tratado como a entrega desse onramp,
 *   que já tem o próprio push. As contas dos parceiros, quando conhecidas,
 *   entram em INCOMING_PAYMENTS_IGNORED_SENDERS e cortam o caso de vez.
 *
 * Robustez: lock em processo contra sobreposição, limite de carteiras e de
 * páginas, erro isolado por carteira, e o cursor só avança depois de a
 * notificação estar gravada, com update condicional (outra instância que já
 * avançou vence, e a dedupeKey cobre o resto).
 */
@Injectable()
export class IncomingPaymentsJob {
  private readonly logger = new Logger(IncomingPaymentsJob.name);
  private running = false;
  /** Último id visto, para o rodízio entre execuções. */
  private lastWalletId: string | undefined;
  private systemSenders: Set<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly horizon: HorizonPaymentsClient,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async watch(): Promise<void> {
    if (this.running || !this.isEnabled()) return;
    const usdc = this.usdcAsset();
    if (!usdc) return;

    this.running = true;
    try {
      const wallets = await this.nextWallets();
      for (const wallet of wallets) {
        try {
          await this.processWallet(wallet, usdc);
        } catch (error) {
          this.logger.warn(
            `Watcher falhou na carteira ${wallet.id}: ${errorMessage(error)}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Watcher de pagamentos falhou: ${errorMessage(error)}`);
    } finally {
      this.running = false;
    }
  }

  private isEnabled(): boolean {
    const value = this.config.get<boolean | string>(
      'INCOMING_PAYMENTS_WATCHER_ENABLED',
    );
    return value !== false && value !== 'false';
  }

  private usdcAsset(): { code: string; issuer: string } | null {
    const code = this.config.get<string>('STELLAR_USDC_ASSET_CODE') ?? 'USDC';
    const issuer = this.config.get<string>('STELLAR_USDC_ISSUER');
    return issuer ? { code, issuer } : null;
  }

  private async nextWallets(): Promise<WatchedWallet[]> {
    const take = Number(
      this.config.get<number>('INCOMING_PAYMENTS_WALLETS_PER_RUN') ??
        DEFAULT_WALLETS_PER_RUN,
    );
    const wallets = await this.prisma.walletAccount.findMany({
      where: {
        isActive: true,
        user: { deletedAt: null },
        ...(this.lastWalletId ? { id: { gt: this.lastWalletId } } : {}),
      },
      orderBy: { id: 'asc' },
      take,
      select: {
        id: true,
        userId: true,
        stellarAddress: true,
        lastPaymentCursor: true,
      },
    });
    // Página cheia: a próxima execução continua daqui. Incompleta: volta ao início.
    this.lastWalletId =
      wallets.length === take ? wallets[wallets.length - 1]?.id : undefined;
    return wallets;
  }

  private async processWallet(
    wallet: WatchedWallet,
    usdc: { code: string; issuer: string },
  ): Promise<void> {
    if (wallet.lastPaymentCursor === null) {
      // Linha de base: o histórico anterior ao watcher não vira push.
      const cursor = await this.horizon.latestCursor(wallet.stellarAddress);
      await this.prisma.walletAccount.updateMany({
        where: { id: wallet.id, lastPaymentCursor: null },
        data: { lastPaymentCursor: cursor },
      });
      return;
    }

    let cursor = wallet.lastPaymentCursor;
    for (let page = 0; page < MAX_PAGES_PER_WALLET; page++) {
      const records = await this.horizon.paymentsAfter(
        wallet.stellarAddress,
        cursor,
        PAGE_SIZE,
      );
      if (records.length === 0) return;

      const incoming = records.filter((r) =>
        isIncomingUsdc(r, wallet.stellarAddress, usdc),
      );
      const senders = await this.resolveSenders(incoming);

      let processedUpTo: string | null = null;
      let stopped = false;
      for (const record of records) {
        if (incoming.includes(record)) {
          const ok = await this.handlePayment(wallet, record, senders);
          if (!ok) {
            stopped = true;
            break;
          }
        }
        processedUpTo = record.paging_token;
      }

      if (processedUpTo) {
        const moved = await this.prisma.walletAccount.updateMany({
          where: { id: wallet.id, lastPaymentCursor: cursor },
          data: { lastPaymentCursor: processedUpTo },
        });
        // Outra execução já avançou esta carteira: deixa com ela.
        if (moved.count === 0) return;
        cursor = processedUpTo;
      }

      if (stopped || records.length < PAGE_SIZE) return;
    }
  }

  /** Devolve false só quando a notificação não pôde ser gravada. */
  private async handlePayment(
    wallet: WatchedWallet,
    record: HorizonPayment,
    senders: Map<string, PigfiSender>,
  ): Promise<boolean> {
    const from = record.from as string;
    if (this.getSystemSenders().has(from)) return true;

    const sender = senders.get(from);
    // Outra carteira do próprio usuário: movimentação interna, não "recebi".
    if (sender?.userId === wallet.userId) return true;

    if (!sender && (await this.hasOnrampNear(wallet.userId, record))) {
      this.logger.debug(
        `Pagamento ${record.id} tratado como entrega de onramp; sem TRANSFER_RECEIVED`,
      );
      return true;
    }

    return this.notifications.notify({
      userId: wallet.userId,
      type: 'TRANSFER_RECEIVED',
      dedupeKey: `payment:${record.id}`,
      data: { paymentId: record.id, txHash: record.transaction_hash },
      details: {
        amount: record.amount,
        asset: record.asset_code,
        username: sender?.username ?? null,
      },
    });
  }

  private async resolveSenders(
    incoming: HorizonPayment[],
  ): Promise<Map<string, PigfiSender>> {
    const addresses = [...new Set(incoming.map((r) => r.from as string))];
    if (addresses.length === 0) return new Map();

    const wallets = await this.prisma.walletAccount.findMany({
      where: {
        stellarAddress: { in: addresses },
        isActive: true,
        user: { deletedAt: null },
      },
      select: {
        stellarAddress: true,
        userId: true,
        user: { select: { username: true } },
      },
    });
    return new Map(
      wallets.map((w) => [
        w.stellarAddress,
        { userId: w.userId, username: w.user.username },
      ]),
    );
  }

  /**
   * Se o usuário tem onramp (BlindPay ou Etherfuse) que explica este pagamento:
   * em andamento, criado nas 72 h anteriores, ou concluído nas 2 h em torno do
   * pagamento.
   */
  private async hasOnrampNear(
    userId: string,
    record: HorizonPayment,
  ): Promise<boolean> {
    const at = new Date(record.created_at).getTime();
    const paidAt = Number.isFinite(at) ? at : Date.now();
    const openSince = new Date(paidAt - ONRAMP_OPEN_WINDOW_MS);
    const completedFrom = new Date(paidAt - ONRAMP_COMPLETED_WINDOW_MS);
    const completedTo = new Date(paidAt + ONRAMP_COMPLETED_WINDOW_MS);

    const blindpay = await this.prisma.onrampTransaction.count({
      where: {
        userId,
        OR: [
          {
            status: {
              in: [
                RampStatus.PENDING,
                RampStatus.AWAITING_PAYMENT,
                RampStatus.PROCESSING,
              ],
            },
            createdAt: { gte: openSince },
          },
          {
            status: RampStatus.COMPLETED,
            completedAt: { gte: completedFrom, lte: completedTo },
          },
        ],
      },
    });
    if (blindpay > 0) return true;

    const etherfuse = await this.prisma.etherfuseOrder.count({
      where: {
        direction: EtherfuseOrderDirection.ONRAMP,
        customer: { userId },
        OR: [
          {
            status: {
              in: [
                EtherfuseOrderStatus.CREATED,
                EtherfuseOrderStatus.PENDING_SIGNATURE,
                EtherfuseOrderStatus.PROCESSING,
              ],
            },
            createdAt: { gte: openSince },
          },
          {
            status: EtherfuseOrderStatus.COMPLETED,
            completedAt: { gte: completedFrom, lte: completedTo },
          },
        ],
      },
    });
    return etherfuse > 0;
  }

  /** Emissor do USDC, tesouraria, agente de presentes e a lista da config. */
  private getSystemSenders(): Set<string> {
    if (this.systemSenders) return this.systemSenders;
    const senders = new Set<string>();

    const issuer = this.config.get<string>('STELLAR_USDC_ISSUER');
    if (issuer) senders.add(issuer);
    for (const key of ['TREASURY_STELLAR_SECRET', 'GIFT_CLAIM_AGENT_SECRET']) {
      const publicKey = publicKeyOf(this.config.get<string>(key));
      if (publicKey) senders.add(publicKey);
    }
    const extra =
      this.config.get<string>('INCOMING_PAYMENTS_IGNORED_SENDERS') ?? '';
    for (const address of extra.split(',').map((a) => a.trim())) {
      if (StrKey.isValidEd25519PublicKey(address)) senders.add(address);
    }

    this.systemSenders = senders;
    return senders;
  }
}

function isIncomingUsdc(
  record: HorizonPayment,
  address: string,
  usdc: { code: string; issuer: string },
): boolean {
  return (
    record.type === 'payment' &&
    record.transaction_successful !== false &&
    record.to === address &&
    typeof record.from === 'string' &&
    record.from !== address &&
    record.asset_type !== 'native' &&
    record.asset_code === usdc.code &&
    record.asset_issuer === usdc.issuer &&
    Number(record.amount) >= MIN_NOTIFY_AMOUNT
  );
}

/** Chave pública de um segredo da config, sem nunca logar o segredo. */
function publicKeyOf(secret: string | undefined): string | null {
  if (!secret) return null;
  try {
    return Keypair.fromSecret(secret).publicKey();
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
