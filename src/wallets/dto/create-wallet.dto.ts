import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateWalletDto {
  @ApiProperty({ description: 'ID of the user to associate this wallet with' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'Stellar wallet address (public key)',
    example: 'GABC...XYZ',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  stellarAddress: string;

  @ApiProperty({
    description: 'Optional label for the wallet',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  label?: string;
}
