// ─── Organizations ────────────────────────────────────────────────────────────

export interface CreateChildOrgParams {
  id: string;
  displayName: string;
  accountType: 'personal' | 'business';
  userInfo?: {
    displayName?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
  };
  wallets?: Array<{
    publicKey: string;
    blockchain: 'stellar' | 'solana' | 'base' | 'polygon' | 'monad';
  }>;
  bankAccount?: Record<string, unknown>;
}

export interface CreateChildOrgResponse {
  organizationId: string;
  displayName: string;
  accountType: 'personal' | 'business';
  partnerFeeDefaultBps: number;
  wallets: Array<{ publicKey: string; blockchain: string }>;
  bankAccount?: Record<string, unknown>;
}

// ─── KYC ──────────────────────────────────────────────────────────────────────

export interface SubmitKycParams {
  pubkey?: string;
  identity: {
    id: string;
    email?: string;
    phoneNumber?: string;
    occupation?: string;
    name?: {
      givenName: string;
      familyName: string;
    };
    dateOfBirth?: string;
    address?: {
      street: string;
      city: string;
      region: string;
      postalCode: string;
      country: string;
    };
    idNumbers?: Array<{ value: string; id: string; type: string }>;
  };
}

export interface UploadKycDocumentParams {
  pubkey: string;
  documentType: 'selfie' | 'document';
  images: Array<{
    label: 'selfie' | 'id_front' | 'id_back';
    image: string; /** base64 data URL, e.g. "data:image/jpeg;base64,..." */
  }>;
}

export interface KycStatusResponse {
  customerId: string;
  walletPublicKey: string;
  status: 'not_started' | 'proposed' | 'approved' | 'approved_chain_deploying' | 'rejected';
  onChainMarked: boolean;
  currentRejectionReason: string | null;
  approvedAt: string | null;
  currentKycInfo: Record<string, unknown>;
}

// ─── Agreements ───────────────────────────────────────────────────────────────

export interface GeneratePresignedUrlParams {
  customerId: string;
  bankAccountId: string;
  publicKey: string;
  blockchain: 'stellar' | 'solana' | 'base' | 'polygon' | 'monad';
  userInfo?: {
    email: string;
    displayName: string;
  };
}

export interface GeneratePresignedUrlResponse {
  presigned_url: string;
}

export interface AcceptAgreementParams {
  presignedUrl: string;
}

// ─── Bank Accounts ────────────────────────────────────────────────────────────

export interface CreateBankAccountApiKeyParams {
  customerId: string;
  account:
    | {
        transactionId: string;
        firstName: string;
        paternalLastName: string;
        maternalLastName: string;
        birthDate: string;
        birthCountryIsoCode: string;
        curp: string;
        rfc: string;
        clabe: string;
      }
    | {
        transactionId: string;
        name: string;
        countryIsoCode: string;
        incorporatedDate: string;
        rfc: string;
        clabe: string;
      };
}

export interface RegisterPixBankAccountParams {
  /** Presigned URL from POST /ramp/onboarding-url */
  presignedUrl: string;
  account: {
    pixKey: string;
    pixKeyType: 'evp' | 'cpf' | 'cnpj' | 'email' | 'phone';
    firstName: string;
    lastName: string;
    /** 11-digit Brazilian CPF */
    cpf: string;
  };
}

export interface EtherfuseBankAccountResponse {
  /** May be returned as `id` or `bankAccountId` depending on the endpoint */
  id?: string;
  bankAccountId?: string;
  customerId?: string;
  clabe?: string;
  abbrClabe?: string;
  pixKey?: string;
  pixKeyType?: string;
  /** 'mxn' → SPEI, 'brl' → PIX */
  currency?: string;
  compliant: boolean;
  needsWork?: boolean;
  status?: string;
  accountType?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ListBankAccountsResponse {
  items?: EtherfuseBankAccountResponse[];
  bankAccounts?: EtherfuseBankAccountResponse[];
  bank_accounts?: EtherfuseBankAccountResponse[];
  data?: EtherfuseBankAccountResponse[];
  accounts?: EtherfuseBankAccountResponse[];
  totalItems?: number;
  pageSize?: number;
  pageNumber?: number;
  totalPages?: number;
}

// ─── Crypto Wallets ───────────────────────────────────────────────────────────

export interface RegisterWalletParams {
  customerId: string;
  publicKey: string;
  blockchain: 'stellar' | 'solana' | 'base' | 'polygon' | 'monad';
}

// ─── Quotes ───────────────────────────────────────────────────────────────────

export interface GetQuoteParams {
  quoteId: string;
  customerId: string;
  blockchain: 'stellar' | 'solana' | 'base' | 'polygon' | 'monad';
  quoteAssets:
    | { type: 'onramp'; sourceAsset: string; targetAsset: string }
    | { type: 'offramp'; sourceAsset: string; targetAsset: string };
  sourceAmount: string;
  walletAddress?: string;
  partnerFeeBps?: number;
}

export interface QuoteResponse {
  quoteId: string;
  blockchain: string;
  quoteAssets: Record<string, unknown>;
  sourceAmount: string;
  destinationAmount: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  exchangeRate: string;
  etherfuseMidMarketRate: string | null;
  feeBps: string | null;
  feeAmount: string | null;
  destinationAmountAfterFee: string | null;
  partnerFeeBps: number | null;
  partnerFeeAmount: string | null;
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export interface CreateOrderParams {
  orderId: string;
  bankAccountId: string;
  quoteId: string;
  publicKey?: string;
  cryptoWalletId?: string;
  memo?: string;
  useAnchor?: boolean;
}

export interface OnrampOrderResponse {
  onramp: {
    id: string;
    status: string;
    sourceAmount: string;
    destinationAmount: string;
    depositInstructions?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };
}

export interface OfframpOrderResponse {
  offramp: {
    id: string;
    status: string;
    sourceAmount: string;
    destinationAmount: string;
    /** Unsigned Stellar transaction XDR (burn transaction) */
    burnTransaction?: string;
    withdrawAnchorAccount?: string;
    withdrawMemo?: string;
    withdrawMemoType?: string;
    createdAt: string;
    updatedAt: string;
  };
}

export type CreateOrderResponse = OnrampOrderResponse | OfframpOrderResponse;

export interface OrderDetailsResponse {
  id: string;
  status: string;
  direction: 'onramp' | 'offramp';
  sourceAmount: string;
  destinationAmount: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  [key: string]: unknown;
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

export interface EtherfuseWebhookPayload {
  id: string;
  eventType: 'bank_account_updated' | 'customer_updated' | 'order_updated' | 'swap_updated' | 'kyc_updated';
  [key: string]: unknown;
}
