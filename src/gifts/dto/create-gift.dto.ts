import { ApiProperty } from '@nestjs/swagger';
import { IsDecimal, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateGiftDto {
  @ApiProperty({
    description: 'Unique key to prevent duplicate processing of the same gift',
    example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotencyKey: string;

  /**
   * Temp: userId will come from JWT once auth is implemented.
   * For now, callers must supply it explicitly (same pattern as deposits).
   */
  @ApiProperty({
    description: 'ID of the user sending the gift',
    example: 'user_123',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'ID of the wallet account funding the gift',
    example: 'wallet_abc',
  })
  @IsString()
  @IsNotEmpty()
  walletAccountId: string;

  /** Gift amount as a decimal string, e.g. "50.00" (max 7 decimal places) */
  @ApiProperty({
    description: 'Amount to gift as a decimal string (USDC)',
    example: '50.00',
  })
  @IsDecimal({ decimal_digits: '0,7', force_decimal: false })
  amount: string;
}
