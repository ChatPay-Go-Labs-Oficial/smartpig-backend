import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { mapEtherfuseError } from './etherfuse.errors';
import {
  AcceptAgreementParams,
  CreateBankAccountApiKeyParams,
  CreateChildOrgParams,
  CreateChildOrgResponse,
  CreateOrderParams,
  CreateOrderResponse,
  EtherfuseBankAccountResponse,
  GeneratePresignedUrlParams,
  GeneratePresignedUrlResponse,
  GetQuoteParams,
  KycStatusResponse,
  OrderDetailsResponse,
  QuoteResponse,
  RegisterPixBankAccountParams,
  RegisterWalletParams,
  SubmitKycParams,
  UploadKycDocumentParams,
} from './dto/etherfuse.dto';

@Injectable()
export class EtherfuseService implements OnModuleInit {
  private readonly logger = new Logger(EtherfuseService.name);
  private http: AxiosInstance;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const apiKey = this.config.getOrThrow<string>('ETHERFUSE_API_KEY');
    const baseUrl = this.config.get<string>('ETHERFUSE_BASE_URL', 'https://api.etherfuse.com');

    // Etherfuse uses API key directly — no Bearer prefix
    this.http = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });

    this.http.interceptors.request.use((cfg) => {
      this.logger.debug(`Etherfuse → ${cfg.method?.toUpperCase()} ${cfg.url}`);
      return cfg;
    });

    this.logger.log('Etherfuse client initialized');
  }

  // ─── Organizations ──────────────────────────────────────────────────────────

  async createChildOrg(params: CreateChildOrgParams): Promise<CreateChildOrgResponse> {
    try {
      const { data } = await this.http.post<CreateChildOrgResponse>('/ramp/organization', params);
      return data;
    } catch (err) {
      mapEtherfuseError(err);
    }
  }

  // ─── KYC ────────────────────────────────────────────────────────────────────

  async submitKyc(customerId: string, params: SubmitKycParams): Promise<void> {
    try {
      await this.http.post(`/ramp/customer/${customerId}/kyc`, params);
    } catch (err) {
      mapEtherfuseError(err);
    }
  }

  async uploadKycDocument(customerId: string, params: UploadKycDocumentParams): Promise<void> {
    try {
      const form = new FormData();
      const fileBuffer = Buffer.from(params.content, 'base64');
      form.append('file', fileBuffer, {
        filename: `${params.documentType}.${params.contentType.split('/')[1] ?? 'jpg'}`,
        contentType: params.contentType,
      });
      form.append('pubkey', params.pubkey);
      form.append('documentType', params.documentType);

      const apiKey = this.config.getOrThrow<string>('ETHERFUSE_API_KEY');
      const baseUrl = this.config.get<string>('ETHERFUSE_BASE_URL', 'https://api.etherfuse.com');

      await axios.post(`${baseUrl}/ramp/customer/${customerId}/kyc/documents`, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: apiKey,
        },
        timeout: 30_000,
      });
    } catch (err) {
      mapEtherfuseError(err);
    }
  }

  async getKycStatus(customerId: string, pubkey: string): Promise<KycStatusResponse> {
    try {
      const { data } = await this.http.get<KycStatusResponse>(
        `/ramp/customer/${customerId}/kyc/${pubkey}`,
      );
      return data;
    } catch (err) {
      mapEtherfuseError(err);
    }
  }

  // ─── Presigned URL ──────────────────────────────────────────────────────────

  async generatePresignedUrl(params: GeneratePresignedUrlParams): Promise<GeneratePresignedUrlResponse> {
    try {
      const { data } = await this.http.post<GeneratePresignedUrlResponse>('/ramp/onboarding-url', params);
      return data;
    } catch (err) {
      mapEtherfuseError(err);
    }
  }

  // ─── Agreements ─────────────────────────────────────────────────────────────

  async acceptElectronicSignature(params: AcceptAgreementParams): Promise<void> {
    try {
      await this.http.post('/ramp/agreements/electronic-signature', {
        presignedUrl: params.presignedUrl,
      });
    } catch (err) {
      mapEtherfuseError(err);
    }
  }

  async acceptTermsAndConditions(params: AcceptAgreementParams): Promise<void> {
    try {
      await this.http.post('/ramp/agreements/terms-and-conditions', {
        presignedUrl: params.presignedUrl,
      });
    } catch (err) {
      mapEtherfuseError(err);
    }
  }

  async acceptCustomerAgreement(params: AcceptAgreementParams): Promise<void> {
    try {
      await this.http.post('/ramp/agreements/customer-agreement', {
        presignedUrl: params.presignedUrl,
      });
    } catch (err) {
      mapEtherfuseError(err);
    }
  }

  // ─── Bank Accounts ──────────────────────────────────────────────────────────

  async createBankAccount(
    params: CreateBankAccountApiKeyParams,
  ): Promise<EtherfuseBankAccountResponse> {
    try {
      const { data } = await this.http.post<EtherfuseBankAccountResponse>(
        `/ramp/customer/${params.customerId}/bank-account`,
        { account: params.account },
      );
      return data;
    } catch (err) {
      mapEtherfuseError(err);
    }
  }

  async listBankAccounts(customerId: string): Promise<EtherfuseBankAccountResponse[]> {
    try {
      const { data } = await this.http.get<unknown>(
        `/ramp/customer/${customerId}/bank-accounts`,
      );
      if (Array.isArray(data)) return data as EtherfuseBankAccountResponse[];
      const obj = data as Record<string, unknown>;
      // Paginated response: { items: [...] }
      const nested =
        obj['items'] ??
        obj['bankAccounts'] ??
        obj['bank_accounts'] ??
        obj['data'] ??
        obj['accounts'];
      if (Array.isArray(nested)) return nested as EtherfuseBankAccountResponse[];
      this.logger.warn(`Unexpected listBankAccounts response shape: ${JSON.stringify(data)}`);
      return [];
    } catch (err) {
      mapEtherfuseError(err);
    }
  }

  async registerPixBankAccount(
    params: RegisterPixBankAccountParams,
  ): Promise<EtherfuseBankAccountResponse> {
    try {
      const { data } = await this.http.post<EtherfuseBankAccountResponse>(
        '/ramp/bank-account',
        { presignedUrl: params.presignedUrl, account: params.account },
      );
      return data;
    } catch (err) {
      mapEtherfuseError(err);
    }
  }

  // ─── Wallets ────────────────────────────────────────────────────────────────

  async registerWallet(params: RegisterWalletParams): Promise<void> {
    try {
      await this.http.post(`/ramp/customer/${params.customerId}/wallet`, {
        publicKey: params.publicKey,
        blockchain: params.blockchain,
      });
    } catch (err) {
      mapEtherfuseError(err);
    }
  }

  // ─── Quotes ─────────────────────────────────────────────────────────────────

  async getQuote(params: GetQuoteParams): Promise<QuoteResponse> {
    try {
      const { data } = await this.http.post<QuoteResponse>('/ramp/quote', params);
      return data;
    } catch (err) {
      mapEtherfuseError(err);
    }
  }

  // ─── Orders ─────────────────────────────────────────────────────────────────

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResponse> {
    try {
      const { data } = await this.http.post<CreateOrderResponse>('/ramp/order', params);
      return data;
    } catch (err) {
      mapEtherfuseError(err);
    }
  }

  async getOrder(orderId: string): Promise<OrderDetailsResponse> {
    try {
      const { data } = await this.http.get<OrderDetailsResponse>(`/ramp/order/${orderId}`);
      return data;
    } catch (err) {
      mapEtherfuseError(err);
    }
  }
}
