import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class EnsureTrustlineDto {
  @ApiProperty({
    description:
      'Registry symbol of the asset, e.g. EURC. "native" resolves to XLM.',
    example: 'EURC',
  })
  @IsString()
  @IsNotEmpty()
  assetSymbol: string;

  /**
   * Declared because the global ValidationPipe uses `forbidNonWhitelisted` and the
   * app's api client injects `userId` into every request. The handler derives the
   * owner from the token and only compares this against it.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;
}

export class SubmitTrustlineDto extends EnsureTrustlineDto {
  @ApiProperty({
    description: 'The trustline XDR with the user signature added.',
  })
  @IsString()
  @IsNotEmpty()
  signedXdr: string;
}
