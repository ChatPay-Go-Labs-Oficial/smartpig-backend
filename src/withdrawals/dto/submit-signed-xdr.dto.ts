import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SubmitSignedXdrDto {
  @ApiProperty({
    description: 'The signed Stellar transaction in XDR format',
    example: 'AAAAAgAAAA...',
  })
  @IsString()
  @IsNotEmpty()
  signedXdr: string;
}
