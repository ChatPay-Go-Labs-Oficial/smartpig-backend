import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { mapBlindPayError } from './blindpay.errors';
import {
  BlindPayBankAccount,
  BlindPayBlockchainWallet,
  BlindPayPayin,
  BlindPayPayinQuote,
  BlindPayPayout,
  BlindPayPayoutQuote,
  BlindPayReceiver,
  CreateBankAccountParams,
  CreateBlockchainWalletParams,
  CreatePayinParams,
  CreatePayinQuoteParams,
  CreatePayoutQuoteParams,
  CreatePayoutStellarParams,
  CreateReceiverParams,
  StellarDelegationResult,
} from './dto/blindpay.dto';

@Injectable()
export class BlindPayService implements OnModuleInit {
  private readonly logger = new Logger(BlindPayService.name);
  private http: AxiosInstance;
  private instanceId: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const apiKey = this.config.getOrThrow<string>('BLINDPAY_API_KEY');
    const baseUrl = this.config.get<string>('BLINDPAY_BASE_URL', 'https://api.blindpay.com');
    this.instanceId = this.config.getOrThrow<string>('BLINDPAY_INSTANCE_ID');

    this.http = axios.create({
      baseURL: `${baseUrl}/v1`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });

    this.logger.log(`BlindPay client initialized (instance: ${this.instanceId})`);
  }

  // ─── Receivers ─────────────────────────────────────────────────────────────

  async createReceiver(params: CreateReceiverParams): Promise<BlindPayReceiver> {
    try {
      const { data } = await this.http.post<BlindPayReceiver>(
        `/instances/${this.instanceId}/receivers`,
        params,
      );
      return data;
    } catch (err) {
      mapBlindPayError(err);
    }
  }

  async getReceiver(receiverId: string): Promise<BlindPayReceiver> {
    try {
      const { data } = await this.http.get<BlindPayReceiver>(
        `/instances/${this.instanceId}/receivers/${receiverId}`,
      );
      return data;
    } catch (err) {
      mapBlindPayError(err);
    }
  }

  // ─── Bank Accounts ──────────────────────────────────────────────────────────

  async createBankAccount(receiverId: string, params: CreateBankAccountParams): Promise<BlindPayBankAccount> {
    try {
      const { data } = await this.http.post<BlindPayBankAccount>(
        `/instances/${this.instanceId}/receivers/${receiverId}/bank-accounts`,
        params,
      );
      return data;
    } catch (err) {
      mapBlindPayError(err);
    }
  }

  async listBankAccounts(receiverId: string): Promise<BlindPayBankAccount[]> {
    try {
      const { data } = await this.http.get<BlindPayBankAccount[]>(
        `/instances/${this.instanceId}/receivers/${receiverId}/bank-accounts`,
      );
      return data;
    } catch (err) {
      mapBlindPayError(err);
    }
  }

  // ─── Blockchain Wallets ────────────────────────────────────────────────────

  async createBlockchainWallet(
    receiverId: string,
    params: CreateBlockchainWalletParams,
  ): Promise<BlindPayBlockchainWallet> {
    try {
      const { data } = await this.http.post<BlindPayBlockchainWallet>(
        `/instances/${this.instanceId}/receivers/${receiverId}/blockchain-wallets`,
        params,
      );
      return data;
    } catch (err) {
      mapBlindPayError(err);
    }
  }

  async listBlockchainWallets(receiverId: string): Promise<BlindPayBlockchainWallet[]> {
    try {
      const { data } = await this.http.get<BlindPayBlockchainWallet[]>(
        `/instances/${this.instanceId}/receivers/${receiverId}/blockchain-wallets`,
      );
      return data;
    } catch (err) {
      mapBlindPayError(err);
    }
  }

  // ─── Payout Quotes ─────────────────────────────────────────────────────────

  async createPayoutQuote(params: CreatePayoutQuoteParams): Promise<BlindPayPayoutQuote> {
    try {
      const { data } = await this.http.post<BlindPayPayoutQuote>(
        `/instances/${this.instanceId}/quotes`,
        params,
      );
      return data;
    } catch (err) {
      mapBlindPayError(err);
    }
  }

  // ─── Stellar Delegation ────────────────────────────────────────────────────

  async prepareStellarDelegation(
    quoteId: string,
    senderWalletAddress: string,
  ): Promise<StellarDelegationResult> {
    try {
      const { data } = await this.http.post<StellarDelegationResult>(
        `/instances/${this.instanceId}/payouts/stellar/authorize`,
        { quote_id: quoteId, sender_wallet_address: senderWalletAddress },
      );
      return data;
    } catch (err) {
      mapBlindPayError(err);
    }
  }

  // ─── Payouts ───────────────────────────────────────────────────────────────

  async createPayoutStellar(params: CreatePayoutStellarParams): Promise<BlindPayPayout> {
    try {
      const { data } = await this.http.post<BlindPayPayout>(
        `/instances/${this.instanceId}/payouts/stellar`,
        params,
      );
      return data;
    } catch (err) {
      mapBlindPayError(err);
    }
  }

  async getPayout(payoutId: string): Promise<BlindPayPayout> {
    try {
      const { data } = await this.http.get<BlindPayPayout>(
        `/instances/${this.instanceId}/payouts/${payoutId}`,
      );
      return data;
    } catch (err) {
      mapBlindPayError(err);
    }
  }

  // ─── Payin Quotes ──────────────────────────────────────────────────────────

  async createPayinQuote(params: CreatePayinQuoteParams): Promise<BlindPayPayinQuote> {
    try {
      const { data } = await this.http.post<BlindPayPayinQuote>(
        `/instances/${this.instanceId}/payin-quotes`,
        params,
      );
      return data;
    } catch (err) {
      mapBlindPayError(err);
    }
  }

  // ─── Payins ────────────────────────────────────────────────────────────────

  async createPayinStellar(params: CreatePayinParams): Promise<BlindPayPayin> {
    try {
      const { data } = await this.http.post<BlindPayPayin>(
        `/instances/${this.instanceId}/payins/evm`,
        params,
      );
      return data;
    } catch (err) {
      mapBlindPayError(err);
    }
  }

  async getPayin(payinId: string): Promise<BlindPayPayin> {
    try {
      const { data } = await this.http.get<BlindPayPayin>(
        `/instances/${this.instanceId}/payins/${payinId}`,
      );
      return data;
    } catch (err) {
      mapBlindPayError(err);
    }
  }
}
