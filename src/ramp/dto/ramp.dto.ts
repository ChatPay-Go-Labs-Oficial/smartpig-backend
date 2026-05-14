import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUrl, Min } from 'class-validator';

// ─── Terms of Service ─────────────────────────────────────────────────────────

export class InitiateTosDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  /** Optional deep-link or URL to redirect after ToS acceptance (receives ?tos_id=to_...) */
  @ApiProperty({
    description: 'Optional URL to redirect after ToS acceptance',
    required: false,
    example: 'https://smartpig.app/tos-success',
  })
  @IsOptional()
  @IsUrl()
  redirectUrl?: string;
}

// ─── Receiver ─────────────────────────────────────────────────────────────────

export class CreateReceiverDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'User email address', example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'User first name', required: false })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiProperty({ description: 'User last name', required: false })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiProperty({ description: 'Tax ID (e.g. CPF for Brazil)', required: false })
  @IsOptional()
  @IsString()
  taxId?: string;

  /** ISO 3166-1 alpha-2 country code. Defaults to 'BR'. */
  @ApiProperty({ description: 'ISO country code', default: 'BR', required: false })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ enum: ['individual', 'business'], required: false })
  @IsOptional()
  @IsEnum(['individual', 'business'])
  type?: 'individual' | 'business';

  @ApiProperty({ enum: ['light', 'standard', 'enhanced'], required: false })
  @IsOptional()
  @IsEnum(['light', 'standard', 'enhanced'])
  kycType?: 'light' | 'standard' | 'enhanced';

  // ─── Standard KYC fields (required when kycType = 'standard') ───────────

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  addressLine1?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  stateProvinceRegion?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  postalCode?: string;

  /** ISO 8601 date string, e.g. '1990-01-15T00:00:00Z' */
  @ApiProperty({
    description: 'User date of birth (ISO 8601)',
    required: false,
    example: '1990-01-15T00:00:00Z',
  })
  @IsOptional()
  @IsISO8601()
  dateOfBirth?: string;

  /** ISO 3166-1 alpha-2 country code of the ID document */
  @ApiProperty({ description: 'Country of ID document', required: false })
  @IsOptional()
  @IsString()
  idDocCountry?: string;

  @ApiProperty({ enum: ['PASSPORT', 'ID_CARD', 'DRIVERS'], required: false })
  @IsOptional()
  @IsEnum(['PASSPORT', 'ID_CARD', 'DRIVERS'])
  idDocType?: 'PASSPORT' | 'ID_CARD' | 'DRIVERS';

  /** URL of selfie image — obtain via POST /ramp/upload */
  @ApiProperty({ description: 'Hosted URL of selfie', required: false })
  @IsOptional()
  @IsUrl()
  selfieFileUrl?: string;

  /** URL of ID document front — obtain via POST /ramp/upload */
  @ApiProperty({ description: 'Hosted URL of ID front', required: false })
  @IsOptional()
  @IsUrl()
  idDocFrontUrl?: string;

  /** URL of ID document back — obtain via POST /ramp/upload */
  @ApiProperty({ description: 'Hosted URL of ID back', required: false })
  @IsOptional()
  @IsUrl()
  idDocBackUrl?: string;

  /**
   * Terms of Service acceptance ID — obtain via POST /ramp/tos flow.
   * Format: to_XXXXXXXXXXXX (exactly 15 chars)
   */
  @ApiProperty({ description: 'ToS acceptance ID', required: false })
  @IsOptional()
  @IsString()
  tosId?: string;
}

// ─── Bank Account ─────────────────────────────────────────────────────────────

export class CreateBankAccountDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  /** Display name for this bank account */
  @ApiProperty({ description: 'Friendly name for the account', example: 'Main Bank Account' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'PIX key for the account', required: false })
  @IsOptional()
  @IsString()
  pixKey?: string;
}

// ─── Blockchain Wallet ────────────────────────────────────────────────────────

export class CreateBlockchainWalletDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  /** Stellar public key (G...) — required for Stellar wallet registration */
  @ApiProperty({ description: 'Stellar public address', example: 'GB...' })
  @IsString()
  stellarAddress: string;

  /** Display name for this wallet */
  @ApiProperty({ description: 'Friendly name for the wallet', required: false })
  @IsOptional()
  @IsString()
  name?: string;
}

// ─── On-ramp ──────────────────────────────────────────────────────────────────

export class OnrampQuoteDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'BlindPay blockchain wallet ID' })
  @IsString()
  blockchainWalletId: string;

  /** Amount in BRL centavos (e.g. R$10.00 = 1000) */
  @ApiProperty({ description: 'Amount in BRL centavos', example: 1000 })
  @IsInt()
  @Min(1)
  amountBrl: number;
}

export class CreateOnrampDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'BlindPay blockchain wallet ID' })
  @IsString()
  blockchainWalletId: string;

  /** Amount in BRL centavos */
  @ApiProperty({ description: 'Amount in BRL centavos', example: 1000 })
  @IsInt()
  @Min(1)
  amountBrl: number;
}

// ─── Off-ramp ─────────────────────────────────────────────────────────────────

export class OfframpQuoteDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'BlindPay bank account ID' })
  @IsString()
  bankAccountId: string;

  /** Amount in micro-USDC (1 USDC = 1_000_000) */
  @ApiProperty({ description: 'Amount in micro-USDC', example: 1000000 })
  @IsInt()
  @Min(1)
  amountUsdc: number;

  @ApiProperty({ description: 'Whether to cover fees from the amount', required: false })
  @IsOptional()
  coverFees?: boolean;
}

export class CreateOfframpDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'BlindPay bank account ID' })
  @IsString()
  bankAccountId: string;

  @ApiProperty({ description: 'Stellar sender address' })
  @IsString()
  senderWalletAddress: string;

  /** Amount in micro-USDC */
  @ApiProperty({ description: 'Amount in micro-USDC', example: 1000000 })
  @IsInt()
  @Min(1)
  amountUsdc: number;

  @ApiProperty({ description: 'Whether to cover fees from the amount', required: false })
  @IsOptional()
  coverFees?: boolean;
}

export class SubmitOfframpDto {
  @ApiProperty({ description: 'Transaction hash from signing the delegation XDR' })
  @IsString()
  /** Transaction hash from signing + submitting the delegation XDR */
  signedDelegationHash: string;
}
