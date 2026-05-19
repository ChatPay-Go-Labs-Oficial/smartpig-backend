import { ApiProperty } from '@nestjs/swagger';
import { IsDecimal, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateWithdrawalDto {
  @ApiProperty({
    description:
      'Unique key to prevent duplicate processing of the same intent',
    example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotencyKey: string;

  /**
   * Temp: userId will come from JWT once auth is implemented.
   */
  @ApiProperty({
    description: 'ID of the user performing the withdrawal',
    example: 'user_123',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'ID of the wallet account to be used',
    example: 'wallet_abc',
  })
  @IsString()
  @IsNotEmpty()
  walletAccountId: string;

  /** Internal VaultCatalog ID */
  @ApiProperty({
    description: 'Internal ID of the vault to withdraw from',
    example: 'vault_789',
  })
  @IsString()
  @IsNotEmpty()
  vaultId: string;

  /**
   * Amount of dfTokens (shares) to withdraw, as a decimal string.
   * e.g. "50.00000000"
   */
  @ApiProperty({
    description: 'Amount of shares (dfTokens) to withdraw',
    example: '50.00000000',
  })
  @IsDecimal({ decimal_digits: '0,8', force_decimal: false })
  shareAmount: string;
}
