import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AcknowledgeDisclosureDto {
  @ApiPropertyOptional({
    description:
      'The version the user actually read. A mismatch is rejected with 409 so ' +
      'consent is never recorded against text nobody saw.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

  @ApiPropertyOptional({
    description: 'App build that displayed the disclosure.',
  })
  @IsOptional()
  @IsString()
  appVersion?: string;

  @ApiPropertyOptional({ enum: ['lite', 'pro'] })
  @IsOptional()
  @IsIn(['lite', 'pro'])
  mode?: 'lite' | 'pro';

  @ApiPropertyOptional({
    description: 'Risk codes actually rendered, for the audit trail.',
    isArray: true,
  })
  @IsOptional()
  @IsString({ each: true })
  shownCodes?: string[];

  /** Injected into every request by the app's axios interceptor. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;
}
