import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Runtime vault controls.
 *
 * Every field is optional: a PATCH carries only what is changing, so flipping
 * `depositsEnabled` does not require restating the metadata.
 */
export class UpdateVaultRegistryDto {
  @ApiPropertyOptional({
    description:
      'Lists or delists the vault. Non-USDC activation requires a published disclosure.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Freezes new deposits while leaving withdrawals open. Never traps funds.',
  })
  @IsOptional()
  @IsBoolean()
  depositsEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'When true, the discovery job stops overwriting name and assetSymbol.',
  })
  @IsOptional()
  @IsBoolean()
  isCurated?: boolean;

  @ApiPropertyOptional({ description: 'Lower sorts first.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;

  @ApiPropertyOptional({
    description: 'Pins the vault as the hero in the app.',
  })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  assetSymbol?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Decimals of the vault asset (usually 7).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(18)
  assetDecimals?: number;

  @ApiPropertyOptional({ description: 'Stellar Asset Contract id (C…).' })
  @IsOptional()
  @IsString()
  assetContractId?: string;

  @ApiPropertyOptional({
    description:
      'The VaultConfigRecord. Validated in full; an invalid record is rejected.',
  })
  @IsOptional()
  @IsObject()
  configRecord?: Record<string, unknown>;

  /**
   * Declared so the global ValidationPipe does not 400 the request.
   *
   * `forbidNonWhitelisted: true` rejects undeclared properties, and the app's axios
   * interceptor injects `userId` into every request. Admin routes are called with
   * curl today, but the same trap caught `BalanceQuery` in vaults.controller.ts.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;
}

export class ImportVaultDto {
  @ApiProperty({ description: 'The DeFindex vault contract id (C…).' })
  @IsString()
  @IsNotEmpty()
  defindexVaultId: string;

  @ApiPropertyOptional({ default: 'DEFINDEX' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  protocol?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  assetSymbol: string;

  @ApiPropertyOptional({ default: 7 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(18)
  assetDecimals?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assetContractId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'The VaultConfigRecord, validated in full.',
  })
  @IsOptional()
  @IsObject()
  configRecord?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;
}

export class CreateDisclosureDto {
  @ApiProperty({
    description:
      'Structured risk entries: [{ code, severity, params?, fallbackText? }].',
    isArray: true,
  })
  @IsObject({ each: true })
  risks: Record<string, unknown>[];

  @ApiPropertyOptional({
    description: 'Plain-language sections, each with lite and pro wording.',
  })
  @IsOptional()
  @IsObject()
  sections?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Explicit version. Omit to take the next one after the highest existing.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

  @ApiPropertyOptional({
    description: 'Publish immediately instead of leaving a draft.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;
}
