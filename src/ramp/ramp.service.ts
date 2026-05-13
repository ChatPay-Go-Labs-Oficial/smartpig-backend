import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../infra/prisma/prisma.service';
import { BlindPayService } from '../blindpay/blindpay.service';
import { ConfigService } from '@nestjs/config';
import {
  CreateBankAccountDto,
  CreateBlockchainWalletDto,
  CreateOfframpDto,
  CreateOnrampDto,
  CreateReceiverDto,
  InitiateTosDto,
  OfframpQuoteDto,
  OnrampQuoteDto,
  SubmitOfframpDto,
} from './dto/ramp.dto';
import { RampStatus } from '@prisma/client';

@Injectable()
export class RampService {
  private readonly logger = new Logger(RampService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blindpay: BlindPayService,
    private readonly config: ConfigService,
  ) { }

  private get network(): 'stellar' | 'stellar_testnet' {
    const env = this.config.get<string>('DEFINDEX_NETWORK', 'testnet');
    return env === 'mainnet' ? 'stellar' : 'stellar_testnet';
  }

  /** USDC on mainnet, USDB on dev/testnet (BlindPay doesn't support USDC in dev) */
  private get rampToken(): 'USDC' | 'USDB' {
    return this.config.get<string>('BLINDPAY_TOKEN', this.network === 'stellar' ? 'USDC' : 'USDB') as 'USDC' | 'USDB';
  }

  // ─── Receiver ──────────────────────────────────────────────────────────────

  async createReceiver(dto: CreateReceiverDto) {
    const existing = await this.prisma.blindPayReceiver.findUnique({
      where: { userId: dto.userId },
    });
    if (existing) {
      throw new BadRequestException('User already has a BlindPay receiver');
    }

    const bpReceiver = await this.blindpay.createReceiver({
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

    return this.prisma.blindPayReceiver.create({
      data: {
        userId: dto.userId,
        blindpayReceiverId: bpReceiver.id,
        name: [dto.firstName, dto.lastName].filter(Boolean).join(' ') || dto.email,
        taxId: dto.taxId,
      },
    });
  }

  async uploadKycFile(fileBuffer: Buffer, originalName: string, mimeType: string): Promise<string> {
    return this.blindpay.uploadFile(fileBuffer, originalName, mimeType, 'onboarding');
  }

  // ─── Terms of Service ──────────────────────────────────────────────────────

  async initiateTos(dto: InitiateTosDto): Promise<{ tosUrl: string }> {
    // BlindPay requires a UUID v4 as idempotency_key
    const idempotencyKey = randomUUID();
    const tosUrl = await this.blindpay.initiateTos(idempotencyKey, dto.redirectUrl || undefined);
    return { tosUrl };
  }

  async getReceiver(userId: string) {
    const receiver = await this.prisma.blindPayReceiver.findUnique({
      where: { userId },
      include: { bankAccounts: true, blockchainWallets: true },
    });
    if (!receiver) throw new NotFoundException('Receiver not found for this user');
    return receiver;
  }

  // ─── Bank Accounts ─────────────────────────────────────────────────────────

  async createBankAccount(dto: CreateBankAccountDto) {
    const receiver = await this.prisma.blindPayReceiver.findUnique({
      where: { userId: dto.userId },
    });
    if (!receiver) throw new NotFoundException('Receiver not found — create it first');

    const bpAccount = await this.blindpay.createBankAccount(
      receiver.blindpayReceiverId,
      {
        type: 'pix',
        name: dto.name,
        pix_key: dto.pixKey,
      },
    );

    return this.prisma.blindPayBankAccount.create({
      data: {
        receiverId: receiver.id,
        blindpayBankAccountId: bpAccount.id,
        type: 'pix',
        pixKey: dto.pixKey,
        isDefault: false,
      },
    });
  }

  async listBankAccounts(userId: string) {
    const receiver = await this.prisma.blindPayReceiver.findUnique({
      where: { userId },
    });
    if (!receiver) throw new NotFoundException('Receiver not found');
    return this.prisma.blindPayBankAccount.findMany({
      where: { receiverId: receiver.id },
    });
  }

  // ─── Blockchain Wallets ────────────────────────────────────────────────────

  async createBlockchainWallet(dto: CreateBlockchainWalletDto) {
    const receiver = await this.prisma.blindPayReceiver.findUnique({
      where: { userId: dto.userId },
    });
    if (!receiver) throw new NotFoundException('Receiver not found — create it first');

    const bpWallet = await this.blindpay.createBlockchainWallet(
      receiver.blindpayReceiverId,
      {
        name: dto.name ?? `Stellar wallet for ${receiver.name}`,
        network: this.network,
        address: dto.stellarAddress,
      },
    );

    const wallet = await this.prisma.blindPayBlockchainWallet.create({
      data: {
        receiverId: receiver.id,
        blindpayWalletId: bpWallet.id,
        network: this.network,
        address: dto.stellarAddress,
      },
    });

    // Request trustline XDR so the client can sign and submit it to Stellar.
    // The wallet must have a USDB trustline before it can receive on-ramp funds.
    const trustlineXdr = await this.blindpay.createAssetTrustline(dto.stellarAddress);

    return { ...wallet, trustlineXdr };
  }

  // ─── On-ramp: Quote ────────────────────────────────────────────────────────

  async getOnrampQuote(dto: OnrampQuoteDto) {
    const wallet = await this.prisma.blindPayBlockchainWallet.findUnique({
      where: { id: dto.blockchainWalletId },
    });
    if (!wallet) throw new NotFoundException('Blockchain wallet not found');

    return this.blindpay.createPayinQuote({
      blockchain_wallet_id: wallet.blindpayWalletId,
      currency_type: 'sender',
      token: this.rampToken,
      payment_method: 'pix',
      request_amount: dto.amountBrl,
    });
  }

  // ─── On-ramp: Create ───────────────────────────────────────────────────────

  async createOnramp(dto: CreateOnrampDto) {
    const receiver = await this.prisma.blindPayReceiver.findUnique({
      where: { userId: dto.userId },
    });
    if (!receiver) throw new NotFoundException('Receiver not found');

    const wallet = await this.prisma.blindPayBlockchainWallet.findUnique({
      where: { id: dto.blockchainWalletId },
    });
    if (!wallet) throw new NotFoundException('Blockchain wallet not found');

    // Create quote
    const quote = await this.blindpay.createPayinQuote({
      blockchain_wallet_id: wallet.blindpayWalletId,
      currency_type: 'sender',
      token: this.rampToken,
      payment_method: 'pix',
      request_amount: dto.amountBrl,
    });

    // Create payin
    const payin = await this.blindpay.createPayinStellar({
      payin_quote_id: quote.id,
    });

    return this.prisma.onrampTransaction.create({
      data: {
        idempotencyKey: `onramp-${dto.userId}-${Date.now()}`,
        userId: dto.userId,
        receiverId: receiver.id,
        blockchainWalletId: wallet.id,
        blindpayPayinId: payin.id,
        blindpayQuoteId: quote.id,
        amountBrl: dto.amountBrl,
        amountUsdc: quote.payin_amount,
        pixCode: payin.pix_code,
        status: RampStatus.AWAITING_PAYMENT,
      },
    });
  }

  async getOnramp(id: string, userId: string) {
    const txn = await this.prisma.onrampTransaction.findFirst({
      where: { id, userId },
    });
    if (!txn) throw new NotFoundException('On-ramp transaction not found');
    return txn;
  }

  // ─── Off-ramp: Quote ───────────────────────────────────────────────────────

  async getOfframpQuote(dto: OfframpQuoteDto) {
    const bankAccount = await this.prisma.blindPayBankAccount.findUnique({
      where: { id: dto.bankAccountId },
    });
    if (!bankAccount) throw new NotFoundException('Bank account not found');

    return this.blindpay.createPayoutQuote({
      bank_account_id: bankAccount.blindpayBankAccountId,
      currency_type: 'sender',
      network: this.network,
      token: this.rampToken,
      request_amount: dto.amountUsdc,
      cover_fees: dto.coverFees ?? false,
    });
  }

  // ─── Off-ramp: Create ──────────────────────────────────────────────────────

  async createOfframp(dto: CreateOfframpDto) {
    const receiver = await this.prisma.blindPayReceiver.findUnique({
      where: { userId: dto.userId },
    });
    if (!receiver) throw new NotFoundException('Receiver not found');

    const bankAccount = await this.prisma.blindPayBankAccount.findUnique({
      where: { id: dto.bankAccountId },
    });
    if (!bankAccount) throw new NotFoundException('Bank account not found');

    // Create quote
    const quote = await this.blindpay.createPayoutQuote({
      bank_account_id: bankAccount.blindpayBankAccountId,
      currency_type: 'sender',
      network: this.network,
      token: this.rampToken,
      request_amount: dto.amountUsdc,
      cover_fees: dto.coverFees ?? false,
    });

    // Prepare Stellar delegation (returns unsigned XDR for the user to sign)
    const delegation = await this.blindpay.prepareStellarDelegation(
      quote.id,
      dto.senderWalletAddress,
    );

    const txn = await this.prisma.offrampTransaction.create({
      data: {
        idempotencyKey: `offramp-${dto.userId}-${Date.now()}`,
        userId: dto.userId,
        receiverId: receiver.id,
        bankAccountId: bankAccount.id,
        blindpayQuoteId: quote.id,
        amountUsdc: dto.amountUsdc,
        amountBrl: quote.receiver_amount,
        senderWalletAddress: dto.senderWalletAddress,
        unsignedDelegationXdr: delegation.transaction_hash,
        status: RampStatus.DELEGATION_NEEDED,
      },
    });

    return {
      id: txn.id,
      status: txn.status,
      amountUsdc: txn.amountUsdc,
      amountBrl: txn.amountBrl,
      unsignedDelegationXdr: txn.unsignedDelegationXdr,
    };
  }

  // ─── Off-ramp: Submit signed delegation ────────────────────────────────────

  async submitOfframp(id: string, userId: string, dto: SubmitOfframpDto) {
    const txn = await this.prisma.offrampTransaction.findFirst({
      where: { id, userId },
    });
    if (!txn) throw new NotFoundException('Off-ramp transaction not found');
    if (txn.status !== RampStatus.DELEGATION_NEEDED) {
      throw new BadRequestException(
        `Cannot submit delegation in status ${txn.status}`,
      );
    }
    if (!txn.blindpayQuoteId) {
      throw new BadRequestException('Missing BlindPay quote ID on transaction');
    }

    // Submit payout to BlindPay with the signed delegation hash
    const payout = await this.blindpay.createPayoutStellar({
      quote_id: txn.blindpayQuoteId,
      sender_wallet_address: txn.senderWalletAddress,
      signed_transaction: dto.signedDelegationHash,
    });

    return this.prisma.offrampTransaction.update({
      where: { id },
      data: {
        blindpayPayoutId: payout.id,
        signedDelegationHash: dto.signedDelegationHash,
        status: RampStatus.PROCESSING,
      },
    });
  }

  async getOfframp(id: string, userId: string) {
    const txn = await this.prisma.offrampTransaction.findFirst({
      where: { id, userId },
    });
    if (!txn) throw new NotFoundException('Off-ramp transaction not found');
    return txn;
  }

  // ─── Webhook ───────────────────────────────────────────────────────────────

  async handlePayinWebhook(payinId: string, bpStatus: string) {
    const txn = await this.prisma.onrampTransaction.findUnique({
      where: { blindpayPayinId: payinId },
    });
    if (!txn) {
      this.logger.warn(`Webhook: onramp txn not found for payin ${payinId}`);
      return;
    }

    const status = this.mapPayinStatus(bpStatus);
    await this.prisma.onrampTransaction.update({
      where: { id: txn.id },
      data: {
        status,
        completedAt: ['COMPLETED', 'FAILED', 'REFUNDED'].includes(status) ? new Date() : undefined,
      },
    });
    this.logger.log(`Onramp ${txn.id} updated to ${status}`);
  }

  async handlePayoutWebhook(payoutId: string, bpStatus: string) {
    const txn = await this.prisma.offrampTransaction.findUnique({
      where: { blindpayPayoutId: payoutId },
    });
    if (!txn) {
      this.logger.warn(`Webhook: offramp txn not found for payout ${payoutId}`);
      return;
    }

    const status = this.mapPayoutStatus(bpStatus);
    await this.prisma.offrampTransaction.update({
      where: { id: txn.id },
      data: {
        status,
        completedAt: ['COMPLETED', 'FAILED'].includes(status) ? new Date() : undefined,
      },
    });
    this.logger.log(`Offramp ${txn.id} updated to ${status}`);
  }

  private mapPayinStatus(bpStatus: string): RampStatus {
    switch (bpStatus) {
      case 'completed': return RampStatus.COMPLETED;
      case 'failed': return RampStatus.FAILED;
      case 'refunded': return RampStatus.REFUNDED;
      case 'on_hold': return RampStatus.PROCESSING;
      default: return RampStatus.PROCESSING;
    }
  }

  private mapPayoutStatus(bpStatus: string): RampStatus {
    switch (bpStatus) {
      case 'completed': return RampStatus.COMPLETED;
      case 'failed': return RampStatus.FAILED;
      case 'on_hold': return RampStatus.PROCESSING;
      default: return RampStatus.PROCESSING;
    }
  }
}
