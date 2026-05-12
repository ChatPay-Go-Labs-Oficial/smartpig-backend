// ─── Receivers ───────────────────────────────────────────────────────────────

export interface CreateReceiverParams {
  type: 'individual' | 'business';
  kyc_type: 'light' | 'standard' | 'enhanced';
  email: string;
  country: string;
  first_name?: string;
  last_name?: string;
  legal_name?: string;
  tax_id?: string;
  phone_number?: string;
  // Standard KYC fields
  address_line_1?: string;
  address_line_2?: string;
  city?: string;
  state_province_region?: string;
  postal_code?: string;
  date_of_birth?: string;
  id_doc_country?: string;
  id_doc_type?: 'PASSPORT' | 'ID_CARD' | 'DRIVERS';
  selfie_file?: string;
  id_doc_front_file?: string;
  id_doc_back_file?: string;
}

export interface BlindPayReceiver {
  id: string;
  type: string;
  kyc_type: string;
  kyc_status: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  legal_name: string | null;
  tax_id: string | null;
  country: string;
  created_at: string;
}

// ─── Bank Accounts ────────────────────────────────────────────────────────────

/** receiver_id is passed in the URL path, not in the body */
export interface CreateBankAccountParams {
  type: 'pix';
  name: string;
  pix_key?: string;
}

export interface BlindPayBankAccount {
  id: string;
  receiver_id: string;
  type: string;
  name: string;
  pix_key: string | null;
  created_at: string;
}

// ─── Blockchain Wallets ───────────────────────────────────────────────────────

/** receiver_id is passed in the URL path, not in the body */
export interface CreateBlockchainWalletParams {
  name: string;
  network: 'stellar' | 'stellar_testnet';
  address?: string;
}

export interface BlindPayBlockchainWallet {
  id: string;
  receiver_id: string;
  name: string;
  network: string;
  address: string | null;
  created_at: string;
}

// ─── Payout Quotes ────────────────────────────────────────────────────────────

export interface CreatePayoutQuoteParams {
  bank_account_id: string;
  /** currency_type: 'sender' means request_amount is the USDC amount sender sends */
  currency_type: 'sender' | 'receiver';
  network: 'stellar' | 'stellar_testnet';
  token: 'USDC';
  /** Amount in smallest units (micro-USDC, i.e. 1 USDC = 1_000_000) */
  request_amount: number;
  /** If true, sender pays all fees; if false, receiver pays fees */
  cover_fees?: boolean;
}

export interface BlindPayPayoutQuote {
  id: string;
  bank_account_id: string;
  request_amount: number;
  /** Amount receiver gets in fiat cents */
  payout_amount: number;
  currency: string;
  token: string;
  fee: number;
  exchange_rate: number;
  expires_at: string;
  token_contract_address: string | null;
  blindpay_contract_address: string | null;
}

// ─── Stellar Delegation ───────────────────────────────────────────────────────

export interface PrepareStelllarDelegationParams {
  instance_id: string;
  quote_id: string;
  sender_wallet_address: string;
}

export interface StellarDelegationResult {
  /** Unsigned XDR transaction for the user to sign */
  transaction: string;
}

// ─── Payouts ─────────────────────────────────────────────────────────────────

export interface CreatePayoutStellarParams {
  quote_id: string;
  sender_wallet_address: string;
  /** Signed XDR transaction returned after signing the delegation */
  signed_transaction?: string;
}

export interface BlindPayPayout {
  id: string;
  status: 'processing' | 'on_hold' | 'failed' | 'completed';
  quote_id: string;
  sender_wallet_address: string;
  created_at: string;
}

// ─── Payin Quotes ─────────────────────────────────────────────────────────────

export interface CreatePayinQuoteParams {
  blockchain_wallet_id: string;
  /** currency_type: 'sender' means request_amount is the BRL amount sender pays */
  currency_type: 'sender' | 'receiver';
  token: 'USDC';
  payment_method: 'pix';
  /** Amount in fiat cents (e.g. R$10.00 = 1000) */
  request_amount: number;
}

export interface BlindPayPayinQuote {
  id: string;
  blockchain_wallet_id: string;
  request_amount: number;
  /** Amount of USDC (in micro-USDC) that will be sent to the wallet */
  payin_amount: number;
  currency: string;
  token: string;
  fee: number;
  exchange_rate: number;
  expires_at: string;
}

// ─── Payins ──────────────────────────────────────────────────────────────────

export interface CreatePayinParams {
  payin_quote_id: string;
}

export interface BlindPayPayin {
  id: string;
  status: 'processing' | 'on_hold' | 'failed' | 'refunded' | 'completed';
  payin_quote_id: string;
  pix_code: string | null;
  memo_code: string | null;
  created_at: string;
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

export interface BlindPayWebhookPayin {
  webhook_event: 'payin.new' | 'payin.completed' | 'payin.failed' | 'payin.refunded';
  id: string;
  status: string;
  pix_code: string | null;
}

export interface BlindPayWebhookPayout {
  webhook_event: 'payout.new' | 'payout.completed' | 'payout.failed';
  id: string;
  status: string;
}

export type BlindPayWebhookEvent = BlindPayWebhookPayin | BlindPayWebhookPayout;
