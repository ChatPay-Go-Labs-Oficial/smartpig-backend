import { IsDecimal, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateWithdrawalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotencyKey: string;

  /**
   * Temp: userId will come from JWT once auth is implemented.
   */
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  walletAccountId: string;

  /** Internal VaultCatalog ID */
  @IsString()
  @IsNotEmpty()
  vaultId: string;

  /**
   * Amount of dfTokens (shares) to withdraw, as a decimal string.
   * e.g. "50.00000000"
   */
  @IsDecimal({ decimal_digits: '0,8', force_decimal: false })
  shareAmount: string;
}
