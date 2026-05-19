import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class WalletLoginDto {
  @ApiProperty({
    description:
      'Ed25519 public key (G... address) that signed the challenge. For regular wallets, this is the wallet address itself. For smart accounts, this is the signer key registered on the smart account.',
    example: 'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'signerPublicKey must be a valid Stellar public key',
  })
  signerPublicKey: string;

  @ApiProperty({
    description: 'Base64-encoded Ed25519 signature of the challenge message',
    example: 'yB0hdWq9q7fE...',
  })
  @IsString()
  @IsNotEmpty()
  signature: string;

  @ApiProperty({
    description:
      'Smart account contract address (C...). Provide this when authenticating via a smart account. The signerPublicKey must be a registered signer on this smart account.',
    example: 'CBH6XACZFDCJUHX2G4ZDNXG5R52JRABJHWLYQOXFYKH6VFYRPAOZ5H7T',
    required: false,
  })
  @IsString()
  @IsOptional()
  @Matches(/^C[A-Z2-7]{55}$/, {
    message:
      'smartAccountAddress must be a valid Stellar contract address (C...)',
  })
  smartAccountAddress?: string;
}
