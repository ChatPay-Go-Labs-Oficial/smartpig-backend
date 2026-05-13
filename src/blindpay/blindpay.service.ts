import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
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

  constructor(private readonly config: ConfigService) { }

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

    this.http.interceptors.request.use((config) => {
      this.logger.debug(`BlindPay → ${config.method?.toUpperCase()} ${config.url} ${JSON.stringify(config.data)}`);
      return config;
    });

    this.logger.log(`BlindPay client initialized (instance: ${this.instanceId})`);
  }

  // ─── File Upload ───────────────────────────────────────────────────────────

  /**
   * Upload a file to BlindPay and return the hosted URL.
   * bucket: 'onboarding' for KYC documents (selfie, ID docs)
   */
  async uploadFile(
    fileBuffer: Buffer,
    originalName: string,
    mimeType: string,
    bucket: 'avatar' | 'onboarding' | 'limit_increase' = 'onboarding',
  ): Promise<string> {
    try {
      const form = new FormData();
      form.append('file', fileBuffer, { filename: originalName, contentType: mimeType });
      form.append('bucket', bucket);

      const apiKey = this.config.getOrThrow<string>('BLINDPAY_API_KEY');
      const baseUrl = this.config.get<string>('BLINDPAY_BASE_URL', 'https://api.blindpay.com');

      const { data } = await axios.post<{ file_url: string }>(
        `${baseUrl}/v1/upload`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 30_000,
        },
      );
      return data.file_url;
    } catch (err) {
      mapBlindPayError(err);
    }
  }

  // ─── Terms of Service ──────────────────────────────────────────────────────

  /**
   * Initiate a Terms of Service session.
   * Returns a URL the end-user must visit to accept the ToS.
   * After acceptance, BlindPay redirects to redirectUrl with ?tos_id=to_...
   */
  async initiateTos(idempotencyKey: string, redirectUrl?: string): Promise<string> {
    try {
      const body: Record<string, string> = { idempotency_key: idempotencyKey };
      if (redirectUrl) body.redirect_url = redirectUrl;

      const { data } = await this.http.post<{ url: string }>(
        `/e/instances/${this.instanceId}/tos`,
        body,
      );
      return data.url;
    } catch (err) {
      mapBlindPayError(err);
    }
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
      const isStellar = params.network === 'stellar' || params.network === 'stellar_testnet';

      // Stellar networks require is_account_abstraction=true and address directly.
      // EVM networks require signature-based registration (signature_tx_hash).
      const body: Record<string, unknown> = {
        name: params.name,
        network: params.network,
        is_account_abstraction: isStellar ? true : false,
      };
      if (params.address) body.address = params.address;

      const { data } = await this.http.post<BlindPayBlockchainWallet>(
        `/instances/${this.instanceId}/receivers/${receiverId}/blockchain-wallets`,
        body,
      );
      return data;
    } catch (err) {
      mapBlindPayError(err);
    }
  }

  async createAssetTrustline(walletAddress: string): Promise<string | null> {
    try {
      const { data } = await this.http.post<{ success: boolean; xdr?: string }>(
        `/instances/${this.instanceId}/create-asset-trustline`,
        { address: walletAddress },
      );
      return data.xdr ?? null;
    } catch (err) {
      // Non-fatal: trustline may already exist or not be needed
      this.logger.warn(`create-asset-trustline failed for ${walletAddress}: ${err?.message}`);
      return null;
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
