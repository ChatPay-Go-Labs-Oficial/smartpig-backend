import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class ClaimGiftDto {
  /**
   * Temp: userId will come from JWT once auth is implemented.
   * For now, callers must supply it explicitly (same pattern as deposits).
   */
  @ApiProperty({
    description: 'ID of the user claiming the gift',
    example: 'user_456',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'ID of the wallet account that will receive the gift',
    example: 'wallet_def',
  })
  @IsString()
  @IsNotEmpty()
  walletAccountId: string;

  @ApiProperty({
    description:
      'Stellar address of the receiving wallet (must match the wallet account)',
    example: 'GABC...XYZ',
  })
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'stellarAddress must be a valid Stellar public key',
  })
  stellarAddress: string;
}
