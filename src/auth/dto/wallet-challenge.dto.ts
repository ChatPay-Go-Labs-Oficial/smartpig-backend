import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class WalletChallengeDto {
  @ApiProperty({
    description:
      'Ed25519 public key (G... address) of the signer that will sign the challenge. ' +
      'For regular wallets: this is the wallet address itself. ' +
      'For smart accounts: this is the registered signer key.',
    example: 'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'signerPublicKey must be a valid Stellar public key',
  })
  signerPublicKey: string;

  @ApiProperty({
    description: 'Alias for signerPublicKey (deprecated)',
    required: false,
    deprecated: true,
  })
  @IsString()
  @IsOptional()
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'stellarAddress must be a valid Stellar public key',
  })
  stellarAddress?: string;
}
