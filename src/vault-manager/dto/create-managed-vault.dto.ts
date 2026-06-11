import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class VaultRolesDto {
  @ApiProperty({ description: 'Stellar address of the vault manager' })
  @IsString()
  @IsNotEmpty()
  manager: string;

  @ApiProperty({ description: 'Stellar address for emergency management' })
  @IsString()
  @IsNotEmpty()
  emergencyManager: string;

  @ApiProperty({ description: 'Stellar address to receive fees' })
  @IsString()
  @IsNotEmpty()
  feeReceiver: string;

  @ApiProperty({ description: 'Stellar address for rebalancing management' })
  @IsString()
  @IsNotEmpty()
  rebalanceManager: string;
}

export class VaultStrategyDto {
  @ApiProperty({ description: 'Stellar contract address of the strategy' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ description: 'Friendly name for the strategy' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Initial amount to allocate', default: 0 })
  @IsNumber()
  @Min(0)
  amount: number;
}

export class VaultAssetDto {
  /** Asset contract address on Stellar */
  @ApiProperty({ description: 'Stellar contract address of the asset' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ description: 'Asset symbol', example: 'USDC' })
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @ApiProperty({
    description: 'Number of decimal places used by the asset',
    example: 7,
    default: 7,
    required: false,
  })
  @IsInt()
  @Min(0)
  @Max(18)
  @IsOptional()
  decimals?: number;

  @ApiProperty({ description: 'Initial asset amount', default: 0 })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({ type: [VaultStrategyDto], description: 'List of strategies for this asset' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VaultStrategyDto)
  strategies: VaultStrategyDto[];
}

export class CreateManagedVaultDto {
  /**
   * Temp: userId will come from JWT once auth is implemented.
   */
  @ApiProperty({ description: 'Internal user ID of the vault creator' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  /** Stellar address of the wallet that will sign the vault creation XDR */
  @ApiProperty({ description: 'Stellar address of the creator/caller' })
  @IsString()
  @IsNotEmpty()
  callerAddress: string;

  @ApiProperty({ description: 'Name of the new vault', example: 'Smart Savings Vault' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Symbol for the vault token', example: 'sSAV' })
  @IsString()
  @IsNotEmpty()
  symbol: string;

  /** Management fee in basis points, e.g. 25 = 0.25% */
  @ApiProperty({ description: 'Management fee in basis points (1 bp = 0.01%)', example: 50 })
  @IsInt()
  @Min(0)
  @Max(10000)
  vaultFeeBps: number;

  @ApiProperty({ type: VaultRolesDto })
  @ValidateNested()
  @Type(() => VaultRolesDto)
  roles: VaultRolesDto;

  @ApiProperty({ type: [VaultAssetDto], description: 'List of assets in the vault' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VaultAssetDto)
  assets: VaultAssetDto[];

  @ApiProperty({ description: 'Whether the vault is upgradable', default: true, required: false })
  @IsBoolean()
  @IsOptional()
  upgradable?: boolean;

  @ApiProperty({ description: 'Optional description of the vault', required: false })
  @IsString()
  @IsOptional()
  description?: string;
}
