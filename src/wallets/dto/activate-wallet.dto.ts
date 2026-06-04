import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class ActivateWalletDto {
  @ApiProperty({
    description: 'ID of the user',
    example: 'nuw8uz50x4swu6b476uf4lla',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'ID of the wallet account to activate',
    example: 'cmp63d000jivmcajyxlkpy',
  })
  @IsString()
  @IsNotEmpty()
  walletAccountId: string;

  @ApiProperty({
    description: 'Stellar public key (G... address) of the account to activate',
    example: 'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
  })
  @IsString()
  @IsNotEmpty()
  @Length(56, 56)
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'stellarAddress must be a valid Stellar public key' })
  stellarAddress: string;
}

export class SubmitActivationDto {
  @ApiProperty({ description: 'ID of the wallet account' })
  @IsString()
  @IsNotEmpty()
  walletAccountId: string;

  @ApiProperty({ description: 'Fully-signed Stellar transaction XDR (base64)' })
  @IsString()
  @IsNotEmpty()
  signedXdr: string;
}
