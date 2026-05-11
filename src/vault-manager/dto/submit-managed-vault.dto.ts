import { IsNotEmpty, IsString } from 'class-validator';

export class SubmitManagedVaultDto {
  /** Signed XDR returned by the Stellar wallet after signing the vault creation transaction */
  @IsString()
  @IsNotEmpty()
  signedXdr: string;
}
