// ─── Receivers ───────────────────────────────────────────────────────────────

export interface CreateReceiverParams {
  name: string;
  tax_id?: string;
}

export interface BlindPayReceiver {
  id: string;
  name: string;
  tax_id: string | null;
  created_at: string;
}

// ─── Bank Accounts ────────────────────────────────────────────────────────────

export interface CreateBankAccountParams {
  receiver_id: string;
  type: 'pix';
  pix_key: string;
  pix_key_type: 'cpf' | 'cnpj' | 'phone' | 'email' | 'random';
}

export interface BlindPayBankAccount {
  id: string;
  receiver_id: string;
  type: string;
  pix_key: string | null;
  created_at: string;
}

// ─── Blockchain Wallets ───────────────────────────────────────────────────────

export interface CreateBlockchainWalletParams {
  receiver_id: string;
  network: 'stellar' | 'stellar_testnet';
  address: string;
}

export interface BlindPayBlockchainWallet {
  id: string;
  receiver_id: string;
  network: string;
  address: string;
  created_at: string;
}

// ─── Payout Quotes ────────────────────────────────────────────────────────────

export interface CreatePayoutQuoteParams {
  bank_account_id: string;
  blockchain: 'stellar' | 'stellar_testnet';
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
  /** Transaction hash returned after signing + submitting the delegation XDR */
  transaction_hash: string;
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
  blockchain: 'stellar' | 'stellar_testnet';
  token: 'USDC';
  currency: 'BRL';
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
