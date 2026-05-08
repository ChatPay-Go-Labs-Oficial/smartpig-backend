import {
  IsDecimal,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateDepositDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotencyKey: string;

  /**
   * Temp: userId will come from JWT once auth is implemented.
   * For now, callers must supply it explicitly.
   */
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  walletAccountId: string;

  /** Internal VaultCatalog ID (not the defindexVaultId) */
  @IsString()
  @IsNotEmpty()
  vaultId: string;

  /** Deposit amount as a decimal string, e.g. "100.50" */
  @IsDecimal({ decimal_digits: '0,8', force_decimal: false })
  amount: string;

  @IsString()
  @IsNotEmpty()
  assetSymbol: string;
}
