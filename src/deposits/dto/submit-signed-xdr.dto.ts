import { IsNotEmpty, IsString } from 'class-validator';

export class SubmitSignedXdrDto {
  @IsString()
  @IsNotEmpty()
  signedXdr: string;
}
