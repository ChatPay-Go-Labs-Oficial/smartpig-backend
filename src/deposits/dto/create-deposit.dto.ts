import { ApiProperty } from '@nestjs/swagger';
import { IsDecimal, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateDepositDto {
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
   * For now, callers must supply it explicitly.
   */
  @ApiProperty({
    description: 'ID of the user performing the deposit',
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

  /** Internal VaultCatalog ID (not the defindexVaultId) */
  @ApiProperty({
    description: 'Internal ID of the vault to deposit into',
    example: 'vault_789',
  })
  @IsString()
  @IsNotEmpty()
  vaultId: string;

  /** Deposit amount as a decimal string, e.g. "100.50" */
  @ApiProperty({
    description: 'Amount to deposit as a decimal string',
    example: '100.50',
  })
  @IsDecimal({ decimal_digits: '0,8', force_decimal: false })
  amount: string;

  @ApiProperty({
    description: 'Symbol of the asset to deposit',
    example: 'USDC',
  })
  @IsString()
  @IsNotEmpty()
  assetSymbol: string;
}
