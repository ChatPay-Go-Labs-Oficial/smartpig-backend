import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class WalletLoginDto {
  @ApiProperty({
    description: 'Stellar wallet address (public key) used to identify the user',
    example: 'GABC...XYZ',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  stellarAddress: string;

  @ApiProperty({
    description: 'Optional display name for the wallet',
    example: 'My main wallet',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  label?: string;
}
