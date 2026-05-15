import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../infra/prisma/prisma.service';
import { EtherfuseService } from '../etherfuse/etherfuse.service';
import {
  AcceptAgreementDto,
  CreateEtherfuseCustomerDto,
  CreateEtherfuseOfframpDto,
  CreateEtherfuseOnrampDto,
  CreatePersonalBankAccountDto,
  CreatePixBankAccountDto,
  GeneratePresignedUrlDto,
  GetEtherfuseQuoteDto,
  GetKycStatusDto,
  SubmitEtherfuseOfframpDto,
  SubmitKycDto,
  UploadKycDocumentDto,
} from './dto/etherfuse-ramp.dto';
import {
  EtherfuseKycStatus,
  EtherfuseOrderDirection,
  EtherfuseOrderStatus,
} from '@prisma/client';

@Injectable()
export class EtherfuseRampService {
  private readonly logger = new Logger(EtherfuseRampService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly etherfuse: EtherfuseService,
  ) {}

  // ─── Onboarding: Create Customer Org ───────────────────────────────────────

  async createCustomer(dto: CreateEtherfuseCustomerDto) {
    const existing = await this.prisma.etherfuseCustomer.findUnique({
      where: { userId: dto.userId },
    });
    if (existing) {
      throw new BadRequestException('User already has an Etherfuse customer record');
    }

    const orgId = randomUUID();
    const nameParts = [dto.firstName, dto.lastName].filter(Boolean).join(' ');
    const displayName: string = dto.displayName || nameParts || dto.email || orgId;

    const org = await this.etherfuse.createChildOrg({
      id: orgId,
      displayName,
      accountType: 'personal',
      userInfo: {
        displayName,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
    });

    return this.prisma.etherfuseCustomer.create({
      data: {
        userId: dto.userId,
        etherfuseOrgId: org.organizationId,
        kycStatus: EtherfuseKycStatus.NOT_STARTED,
      },
    });
  }

  async getCustomer(userId: string) {
    const customer = await this.prisma.etherfuseCustomer.findUnique({
      where: { userId },
      include: { bankAccounts: true, orders: true },
    });
    if (!customer) throw new NotFoundException('Etherfuse customer not found for this user');
    return customer;
  }

  // ─── KYC ────────────────────────────────────────────────────────────────────

  async submitKyc(dto: SubmitKycDto) {
    const customer = await this.requireCustomer(dto.userId);

    // Wallet must be registered before KYC; ignore if already registered (409/duplicate)
    try {
      await this.etherfuse.registerWallet({
        customerId: customer.etherfuseOrgId,
        publicKey: dto.pubkey,
        blockchain: 'stellar',
      });
    } catch (err: any) {
      const status: number | undefined = err?.response?.status ?? err?.status;
      if (status !== 409) throw err;
      this.logger.debug(`Wallet ${dto.pubkey} already registered for customer ${customer.etherfuseOrgId}`);
    }

    await this.etherfuse.submitKyc(customer.etherfuseOrgId, {
      pubkey: dto.pubkey,
      identity: {
        id: randomUUID(),
        email: dto.email,
        phoneNumber: dto.phoneNumber,
        occupation: dto.occupation,
        name: dto.name,
        dateOfBirth: dto.dateOfBirth,
        address: dto.address,
        idNumbers: dto.idNumbers?.map(n => ({ value: n.value, id: n.value, type: n.type })),
      },
    });

    return this.prisma.etherfuseCustomer.update({
      where: { id: customer.id },
      data: { kycStatus: EtherfuseKycStatus.PROPOSED },
    });
  }

  async uploadKycDocument(
    dto: UploadKycDocumentDto,
    fileBuffer: Buffer,
    mimeType: string,
  ) {
    const customer = await this.requireCustomer(dto.userId);

    await this.etherfuse.uploadKycDocument(customer.etherfuseOrgId, {
      pubkey: dto.pubkey,
      content: fileBuffer.toString('base64'),
      documentType: dto.documentType,
      contentType: mimeType,
    });

    return { success: true };
  }

  async getKycStatus(dto: GetKycStatusDto) {
    const customer = await this.requireCustomer(dto.userId);

    const status = await this.etherfuse.getKycStatus(
      customer.etherfuseOrgId,
      dto.pubkey,
    );

    // Sync KYC status to our DB
    const mappedStatus = this.mapKycStatus(status.status);
    if (customer.kycStatus !== mappedStatus) {
      await this.prisma.etherfuseCustomer.update({
        where: { id: customer.id },
        data: { kycStatus: mappedStatus },
      });
    }

    return status;
  }

  // ─── Presigned URL ──────────────────────────────────────────────────────────

  async generatePresignedUrl(dto: GeneratePresignedUrlDto) {
    const customer = await this.requireCustomer(dto.userId);

    // Generate a UUID that will identify the bank account once registered.
    // Etherfuse uses this to bind the onboarding session to a specific account.
    const futureBankAccountId = randomUUID();

    const result = await this.etherfuse.generatePresignedUrl({
      customerId: customer.etherfuseOrgId,
      bankAccountId: futureBankAccountId,
      publicKey: dto.pubkey,
      blockchain: 'stellar',
    });

    return {
      presignedUrl: result.presigned_url,
      bankAccountId: futureBankAccountId,
    };
  }

  // ─── Agreements ─────────────────────────────────────────────────────────────

  async acceptElectronicSignature(dto: AcceptAgreementDto) {
    await this.etherfuse.acceptElectronicSignature({ presignedUrl: dto.presignedUrl });
    return { accepted: true };
  }

  async acceptTermsAndConditions(dto: AcceptAgreementDto) {
    await this.etherfuse.acceptTermsAndConditions({ presignedUrl: dto.presignedUrl });
    return { accepted: true };
  }

  async acceptCustomerAgreement(dto: AcceptAgreementDto) {
    await this.etherfuse.acceptCustomerAgreement({ presignedUrl: dto.presignedUrl });
    return { accepted: true };
  }

  // ─── Bank Accounts ──────────────────────────────────────────────────────────

  async createBankAccount(dto: CreatePersonalBankAccountDto) {
    const customer = await this.requireCustomer(dto.userId);

    const result = await this.etherfuse.createBankAccount({
      customerId: customer.etherfuseOrgId,
      account: {
        transactionId: dto.transactionId,
        firstName: dto.firstName,
        paternalLastName: dto.paternalLastName,
        maternalLastName: dto.maternalLastName,
        birthDate: dto.birthDate,
        birthCountryIsoCode: dto.birthCountryIsoCode,
        curp: dto.curp,
        rfc: dto.rfc,
        clabe: dto.clabe,
      },
    });

    const etherfuseBankId = result.bankAccountId ?? result.id ?? '';
    return this.prisma.etherfuseBankAccount.create({
      data: {
        customerId: customer.id,
        etherfuseBankId,
        clabe: dto.clabe,
        rail: 'spei',
        accountType: 'personal',
        isCompliant: result.compliant ?? false,
      },
    });
  }

  async createPixBankAccount(_dto: CreatePixBankAccountDto) {
    // NOTE: Etherfuse's POST /ramp/bank-account currently only accepts CLABE (Mexico).
    // The PIX variant (Brazil/BRL) is not yet implemented in their API.
    // This endpoint is reserved for when Etherfuse adds PIX support.
    // Reference: https://docs.etherfuse.com/api-reference/bank-accounts/create-bank-account-presigned-url.md
    throw new BadRequestException(
      'PIX bank account registration is not yet supported by Etherfuse. ' +
        'For BRL on-ramp, Etherfuse provides their own PIX deposit key at order creation. ' +
        'Check back when Etherfuse adds PIX off-ramp bank account support.',
    );
  }

  async listBankAccounts(userId: string) {
    const customer = await this.requireCustomer(userId);
    return this.prisma.etherfuseBankAccount.findMany({
      where: { customerId: customer.id },
    });
  }

  // ─── Quotes ─────────────────────────────────────────────────────────────────

  async getQuote(dto: GetEtherfuseQuoteDto) {
    const customer = await this.requireCustomer(dto.userId);

    return this.etherfuse.getQuote({
      quoteId: randomUUID(),
      customerId: customer.etherfuseOrgId,
      blockchain: 'stellar',
      quoteAssets: {
        type: dto.direction,
        sourceAsset: dto.sourceAsset,
        targetAsset: dto.targetAsset,
      },
      sourceAmount: dto.sourceAmount,
      walletAddress: dto.walletAddress,
    });
  }

  // ─── On-ramp ────────────────────────────────────────────────────────────────

  async createOnramp(dto: CreateEtherfuseOnrampDto) {
    const customer = await this.requireCustomer(dto.userId);

    const bankAccount = await this.prisma.etherfuseBankAccount.findUnique({
      where: { id: dto.bankAccountId },
    });
    if (!bankAccount) throw new NotFoundException('Bank account not found');
    if (!bankAccount.isCompliant) {
      throw new BadRequestException('Bank account is not yet compliant — KYC must be approved first');
    }

    const orderId = randomUUID();
    const result = await this.etherfuse.createOrder({
      orderId,
      bankAccountId: bankAccount.etherfuseBankId,
      quoteId: dto.quoteId,
      publicKey: dto.walletAddress,
    });

    const onramp = (result as any).onramp;

    return this.prisma.etherfuseOrder.create({
      data: {
        idempotencyKey: orderId,
        customerId: customer.id,
        bankAccountId: bankAccount.id,
        etherfuseOrderId: onramp?.id ?? orderId,
        etherfuseQuoteId: dto.quoteId,
        direction: EtherfuseOrderDirection.ONRAMP,
        status: EtherfuseOrderStatus.PROCESSING,
        sourceAsset: dto.sourceAsset,
        targetAsset: dto.targetAsset,
        sourceAmount: dto.sourceAmount,
        destinationAmount: dto.destinationAmount,
        walletAddress: dto.walletAddress,
      },
    });
  }

  // ─── Off-ramp ────────────────────────────────────────────────────────────────

  async createOfframp(dto: CreateEtherfuseOfframpDto) {
    const customer = await this.requireCustomer(dto.userId);

    const bankAccount = await this.prisma.etherfuseBankAccount.findUnique({
      where: { id: dto.bankAccountId },
    });
    if (!bankAccount) throw new NotFoundException('Bank account not found');
    if (!bankAccount.isCompliant) {
      throw new BadRequestException('Bank account is not yet compliant — KYC must be approved first');
    }

    const orderId = randomUUID();
    const result = await this.etherfuse.createOrder({
      orderId,
      bankAccountId: bankAccount.etherfuseBankId,
      quoteId: dto.quoteId,
      publicKey: dto.walletAddress,
    });

    const offramp = (result as any).offramp;
    const unsignedBurnXdr: string | undefined = offramp?.burnTransaction;

    const order = await this.prisma.etherfuseOrder.create({
      data: {
        idempotencyKey: orderId,
        customerId: customer.id,
        bankAccountId: bankAccount.id,
        etherfuseOrderId: offramp?.id ?? orderId,
        etherfuseQuoteId: dto.quoteId,
        direction: EtherfuseOrderDirection.OFFRAMP,
        status: unsignedBurnXdr
          ? EtherfuseOrderStatus.PENDING_SIGNATURE
          : EtherfuseOrderStatus.PROCESSING,
        sourceAsset: dto.sourceAsset,
        targetAsset: dto.targetAsset,
        sourceAmount: dto.sourceAmount,
        destinationAmount: dto.destinationAmount,
        walletAddress: dto.walletAddress,
        unsignedBurnXdr: unsignedBurnXdr ?? null,
      },
    });

    return {
      id: order.id,
      status: order.status,
      sourceAmount: order.sourceAmount,
      destinationAmount: order.destinationAmount,
      unsignedBurnXdr: order.unsignedBurnXdr ?? undefined,
    };
  }

  async submitOfframp(id: string, userId: string, dto: SubmitEtherfuseOfframpDto) {
    const customer = await this.requireCustomer(userId);

    const order = await this.prisma.etherfuseOrder.findFirst({
      where: { id, customerId: customer.id },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== EtherfuseOrderStatus.PENDING_SIGNATURE) {
      throw new BadRequestException(
        `Cannot submit signed XDR in status ${order.status}`,
      );
    }

    // The signed XDR is submitted directly to Stellar by the mobile app.
    // We record it and update the order status to PROCESSING.
    return this.prisma.etherfuseOrder.update({
      where: { id },
      data: {
        signedBurnXdr: dto.signedBurnXdr,
        status: EtherfuseOrderStatus.PROCESSING,
      },
    });
  }

  async getOrder(id: string, userId: string) {
    const customer = await this.requireCustomer(userId);
    const order = await this.prisma.etherfuseOrder.findFirst({
      where: { id, customerId: customer.id },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  // ─── Webhook ────────────────────────────────────────────────────────────────

  async handleOrderUpdated(etherfuseOrderId: string, status: string) {
    const order = await this.prisma.etherfuseOrder.findUnique({
      where: { etherfuseOrderId },
    });
    if (!order) {
      this.logger.warn(`Webhook: order not found for Etherfuse ID ${etherfuseOrderId}`);
      return;
    }

    const mapped = this.mapOrderStatus(status);
    await this.prisma.etherfuseOrder.update({
      where: { id: order.id },
      data: {
        status: mapped,
        completedAt: ['COMPLETED', 'FAILED', 'REFUNDED'].includes(mapped) ? new Date() : undefined,
      },
    });
    this.logger.log(`EtherfuseOrder ${order.id} updated to ${mapped}`);
  }

  async handleKycUpdated(customerId: string, approved: boolean) {
    const customer = await this.prisma.etherfuseCustomer.findUnique({
      where: { etherfuseOrgId: customerId },
    });
    if (!customer) {
      this.logger.warn(`Webhook: customer not found for Etherfuse org ${customerId}`);
      return;
    }

    const kycStatus = approved
      ? EtherfuseKycStatus.APPROVED
      : EtherfuseKycStatus.REJECTED;

    await this.prisma.etherfuseCustomer.update({
      where: { id: customer.id },
      data: { kycStatus },
    });
    this.logger.log(`EtherfuseCustomer ${customer.id} KYC → ${kycStatus}`);
  }

  async handleBankAccountUpdated(bankAccountId: string, compliant: boolean) {
    const account = await this.prisma.etherfuseBankAccount.findUnique({
      where: { etherfuseBankId: bankAccountId },
    });
    if (!account) {
      this.logger.warn(`Webhook: bank account not found for Etherfuse ID ${bankAccountId}`);
      return;
    }

    await this.prisma.etherfuseBankAccount.update({
      where: { id: account.id },
      data: { isCompliant: compliant },
    });
    this.logger.log(`EtherfuseBankAccount ${account.id} compliant → ${compliant}`);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async requireCustomer(userId: string) {
    const customer = await this.prisma.etherfuseCustomer.findUnique({
      where: { userId },
    });
    if (!customer) {
      throw new NotFoundException(
        'Etherfuse customer not found — call POST /etherfuse/onboarding/organization first',
      );
    }
    return customer;
  }

  private mapKycStatus(status: string): EtherfuseKycStatus {
    switch (status) {
      case 'not_started': return EtherfuseKycStatus.NOT_STARTED;
      case 'proposed': return EtherfuseKycStatus.PROPOSED;
      case 'approved': return EtherfuseKycStatus.APPROVED;
      case 'approved_chain_deploying': return EtherfuseKycStatus.APPROVED_CHAIN_DEPLOYING;
      case 'rejected': return EtherfuseKycStatus.REJECTED;
      default: return EtherfuseKycStatus.NOT_STARTED;
    }
  }

  private mapOrderStatus(status: string): EtherfuseOrderStatus {
    switch (status) {
      case 'completed': return EtherfuseOrderStatus.COMPLETED;
      case 'failed': return EtherfuseOrderStatus.FAILED;
      case 'refunded': return EtherfuseOrderStatus.REFUNDED;
      case 'processing': return EtherfuseOrderStatus.PROCESSING;
      default: return EtherfuseOrderStatus.PROCESSING;
    }
  }
}
