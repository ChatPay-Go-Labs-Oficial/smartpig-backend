import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class TrustlineXdrDto {
  @ApiProperty({
    description: 'Stellar public key (G... address) of the account that will sign the trustline',
    example: 'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
  })
  @IsString()
  @IsNotEmpty()
  @Length(56, 56)
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'stellarAddress must be a valid Stellar public key' })
  stellarAddress: string;
}
