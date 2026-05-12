import { IsEmail, IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUrl, Min } from 'class-validator';

// ─── Terms of Service ─────────────────────────────────────────────────────────

export class InitiateTosDto {
  @IsString()
  userId: string;

  /** Optional deep-link or URL to redirect after ToS acceptance (receives ?tos_id=to_...) */
  @IsOptional()
  @IsUrl()
  redirectUrl?: string;
}

// ─── Receiver ─────────────────────────────────────────────────────────────────

export class CreateReceiverDto {
  @IsString()
  userId: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  taxId?: string;

  /** ISO 3166-1 alpha-2 country code. Defaults to 'BR'. */
  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsEnum(['individual', 'business'])
  type?: 'individual' | 'business';

  @IsOptional()
  @IsEnum(['light', 'standard', 'enhanced'])
  kycType?: 'light' | 'standard' | 'enhanced';

  // ─── Standard KYC fields (required when kycType = 'standard') ───────────

  @IsOptional()
  @IsString()
  addressLine1?: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  stateProvinceRegion?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  /** ISO 8601 date string, e.g. '1990-01-15T00:00:00Z' */
  @IsOptional()
  @IsISO8601()
  dateOfBirth?: string;

  /** ISO 3166-1 alpha-2 country code of the ID document */
  @IsOptional()
  @IsString()
  idDocCountry?: string;

  @IsOptional()
  @IsEnum(['PASSPORT', 'ID_CARD', 'DRIVERS'])
  idDocType?: 'PASSPORT' | 'ID_CARD' | 'DRIVERS';

  /** URL of selfie image — obtain via POST /ramp/upload */
  @IsOptional()
  @IsUrl()
  selfieFileUrl?: string;

  /** URL of ID document front — obtain via POST /ramp/upload */
  @IsOptional()
  @IsUrl()
  idDocFrontUrl?: string;

  /** URL of ID document back — obtain via POST /ramp/upload */
  @IsOptional()
  @IsUrl()
  idDocBackUrl?: string;

  /**
   * Terms of Service acceptance ID — obtain via POST /ramp/tos flow.
   * Format: to_XXXXXXXXXXXX (exactly 15 chars)
   */
  @IsOptional()
  @IsString()
  tosId?: string;
}

// ─── Bank Account ─────────────────────────────────────────────────────────────

export class CreateBankAccountDto {
  @IsString()
  userId: string;

  /** Display name for this bank account */
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  pixKey?: string;
}

// ─── Blockchain Wallet ────────────────────────────────────────────────────────

export class CreateBlockchainWalletDto {
  @IsString()
  userId: string;

  @IsString()
  stellarAddress: string;

  /** Display name for this wallet */
  @IsOptional()
  @IsString()
  name?: string;
}

// ─── On-ramp ──────────────────────────────────────────────────────────────────

export class OnrampQuoteDto {
  @IsString()
  userId: string;

  @IsString()
  blockchainWalletId: string;

  /** Amount in BRL centavos (e.g. R$10.00 = 1000) */
  @IsInt()
  @Min(1)
  amountBrl: number;
}

export class CreateOnrampDto {
  @IsString()
  userId: string;

  @IsString()
  blockchainWalletId: string;

  /** Amount in BRL centavos */
  @IsInt()
  @Min(1)
  amountBrl: number;
}

// ─── Off-ramp ─────────────────────────────────────────────────────────────────

export class OfframpQuoteDto {
  @IsString()
  userId: string;

  @IsString()
  bankAccountId: string;

  /** Amount in micro-USDC (1 USDC = 1_000_000) */
  @IsInt()
  @Min(1)
  amountUsdc: number;

  @IsOptional()
  coverFees?: boolean;
}

export class CreateOfframpDto {
  @IsString()
  userId: string;

  @IsString()
  bankAccountId: string;

  @IsString()
  senderWalletAddress: string;

  /** Amount in micro-USDC */
  @IsInt()
  @Min(1)
  amountUsdc: number;

  @IsOptional()
  coverFees?: boolean;
}

export class SubmitOfframpDto {
  @IsString()
  /** Transaction hash from signing + submitting the delegation XDR */
  signedDelegationHash: string;
}
