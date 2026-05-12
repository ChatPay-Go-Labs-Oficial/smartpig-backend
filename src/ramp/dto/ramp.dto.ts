import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

// ─── Receiver ─────────────────────────────────────────────────────────────────

export class CreateReceiverDto {
  @IsString()
  userId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  taxId?: string;
}

// ─── Bank Account ─────────────────────────────────────────────────────────────

export class CreateBankAccountDto {
  @IsString()
  userId: string;

  @IsEnum(['cpf', 'cnpj', 'phone', 'email', 'random'])
  pixKeyType: 'cpf' | 'cnpj' | 'phone' | 'email' | 'random';

  @IsString()
  pixKey: string;
}

// ─── Blockchain Wallet ────────────────────────────────────────────────────────

export class CreateBlockchainWalletDto {
  @IsString()
  userId: string;

  @IsString()
  stellarAddress: string;
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
