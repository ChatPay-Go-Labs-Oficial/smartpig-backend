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
  /** Accepted Terms of Service ID — obtain via POST /ramp/tos */
  tos_id?: string;
}

/** Valores de kyc_status devolvidos pela BlindPay. */
export type BlindPayKycStatusValue =
  | 'verifying'
  | 'approved'
  | 'rejected'
  | 'compliance_request'
  | 'approved_rfi';

export interface BlindPayReceiver {
  id: string;
  type: string;
  kyc_type: string;
  kyc_status: BlindPayKycStatusValue | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  legal_name: string | null;
  tax_id: string | null;
  country: string;
  created_at: string;
  /**
   * Feedback do compliance quando o KYC é rejeitado. O formato exato não é
   * documentado pela BlindPay — mantemos `unknown` e persistimos cru, em vez
   * de inventar um shape que pode não bater com o payload real.
   */
  kyc_warnings?: unknown;
  fraud_warnings?: unknown;
}

// ─── RFI (Request for Information) ────────────────────────────────────────────

/** Um input que o compliance pediu. `key` é a chave usada no corpo da resposta. */
export interface BlindPayRfiField {
  key: string;
  label: string;
  required: boolean;
  /** Regex que o valor precisa satisfazer (ex.: `^https://[^\s]+$` para upload). */
  regex?: string;
  /** Presente → o campo é um dropdown e o valor deve ser um dos `value`. */
  items?: { label: string; value: string }[];
  /** `true` → o campo aceita um array de URLs (máx. 20). */
  multiple?: boolean;
}

/** Uma pergunta autocontida do compliance. `description` é para exibir verbatim. */
export interface BlindPayRfiSection {
  title: string;
  description: string;
  /** URL opcional de modelo/exemplo de documento. */
  supporting_document?: string;
  fields: BlindPayRfiField[];
}

export interface BlindPayRfi {
  id: string;
  customer_id: string;
  instance_id: string;
  status: 'pending' | 'submitted' | 'expired' | 'cancelled';
  request: BlindPayRfiSection[];
  response: Record<string, unknown>;
  /** Prazo de 27 dias. Estourar sem responder auto-rejeita o cliente. */
  expires_at: string;
  submitted_at: string | null;
  created_at: string;
}

/** Corpo flat da resposta, com as chaves vindas de `BlindPayRfiField.key`. */
export type BlindPayRfiResponseBody = Record<string, string | string[]>;

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
  is_account_abstraction?: boolean;
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
  token: 'USDC' | 'USDT' | 'USDB';
  /**
   * Amount in cents (BlindPay API: "1000 represents 10.00, 2050 represents
   * 20.50") — NOT micro-USDC. Callers holding a micro-USDC amount (the
   * convention everywhere else in this codebase) must convert first, e.g.
   * `RampService.microUsdcToCents`.
   */
  request_amount: number;
  /** If true, sender pays all fees; if false, receiver pays fees */
  cover_fees?: boolean;
  /** Partner fee ID from the BlindPay dashboard. Omit/null uses the instance default. */
  partner_fee_id?: string | null;
}

export interface BlindPayPayoutQuote {
  id: string;
  /** Amount sender sends in micro-token units */
  sender_amount: number;
  /** Amount receiver gets in fiat cents (BRL centavos) */
  receiver_amount: number;
  commercial_quotation: number;
  blindpay_quotation: number;
  flat_fee: number;
  partner_fee_amount: number;
  billing_fee_amount: number;
  expires_at: number;
  contract: {
    address: string;
    network: { chainId: number; name: string };
  } | null;
}

// ─── Stellar Delegation ───────────────────────────────────────────────────────

export interface PrepareStelllarDelegationParams {
  instance_id: string;
  quote_id: string;
  sender_wallet_address: string;
}

export interface StellarDelegationResult {
  /**
   * Unsigned XDR envelope returned by BlindPay's /payouts/stellar/authorize.
   * Despite the field name, this is a base64-encoded Stellar transaction XDR
   * that must be signed by the user's wallet before submitting the payout.
   */
  transaction_hash: string;
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
  token: 'USDC' | 'USDT' | 'USDB';
  payment_method: 'pix';
  /** Amount in fiat cents (e.g. R$10.00 = 1000) */
  request_amount: number;
  /** Partner fee ID from the BlindPay dashboard. Omit/null uses the instance default. */
  partner_fee_id?: string | null;
}

export interface BlindPayPayinQuote {
  id: string;
  /** Amount of stablecoin the wallet will receive */
  receiver_amount: number;
  /** Amount in fiat cents (BRL centavos) the sender must send */
  sender_amount: number;
  commercial_quotation: number;
  blindpay_quotation: number;
  flat_fee: number;
  partner_fee_amount: number;
  billing_fee_amount: number;
  expires_at: number;
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
  webhook_event:
    | 'payin.new'
    | 'payin.completed'
    | 'payin.failed'
    | 'payin.refunded';
  id: string;
  status: string;
  pix_code: string | null;
}

export interface BlindPayWebhookPayout {
  webhook_event: 'payout.new' | 'payout.completed' | 'payout.failed';
  id: string;
  status: string;
}

/**
 * `customer.update` dispara em toda mudança de kyc_status — é o único aviso
 * proativo que a BlindPay dá de aprovação, rejeição ou abertura de RFI.
 * `id` é o customer (`re_...`), não o id local.
 */
export interface BlindPayWebhookCustomer {
  webhook_event: 'customer.new' | 'customer.update' | 'customer.delete';
  id: string;
  instance_id?: string;
  kyc_status?: BlindPayKycStatusValue;
  kyc_warnings?: unknown;
  fraud_warnings?: unknown;
  first_name?: string | null;
  last_name?: string | null;
}

export type BlindPayWebhookEvent =
  | BlindPayWebhookPayin
  | BlindPayWebhookPayout
  | BlindPayWebhookCustomer;
