import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SubmitManagedVaultDto {
  /** Signed XDR returned by the Stellar wallet after signing the vault creation transaction */
  @ApiProperty({
    description: 'The signed Stellar transaction (XDR) to create the vault',
    example: 'AAAAAgAAAA...',
  })
  @IsString()
  @IsNotEmpty()
  signedXdr: string;
}
