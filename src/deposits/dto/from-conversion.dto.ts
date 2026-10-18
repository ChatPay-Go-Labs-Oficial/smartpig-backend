import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDepositFromConversionDto {
  @ApiProperty({ description: 'The confirmed AssetConversion to consume.' })
  @IsString()
  @IsNotEmpty()
  conversionId: string;

  @ApiProperty({
    description: 'Unique key, so a retry does not create a second intent.',
    example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotencyKey: string;

  @ApiProperty({ description: 'ID of the wallet account to be used' })
  @IsString()
  @IsNotEmpty()
  walletAccountId: string;

  /** Injected into every request by the app's api client. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;
}
