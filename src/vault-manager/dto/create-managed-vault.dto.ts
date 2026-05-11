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
  @IsString()
  @IsNotEmpty()
  manager: string;

  @IsString()
  @IsNotEmpty()
  emergencyManager: string;

  @IsString()
  @IsNotEmpty()
  feeReceiver: string;

  @IsString()
  @IsNotEmpty()
  rebalanceManager: string;
}

export class VaultStrategyDto {
  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  amount: number;
}

export class VaultAssetDto {
  /** Asset contract address on Stellar */
  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VaultStrategyDto)
  strategies: VaultStrategyDto[];
}

export class CreateManagedVaultDto {
  /**
   * Temp: userId will come from JWT once auth is implemented.
   */
  @IsString()
  @IsNotEmpty()
  userId: string;

  /** Stellar address of the wallet that will sign the vault creation XDR */
  @IsString()
  @IsNotEmpty()
  callerAddress: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  symbol: string;

  /** Management fee in basis points, e.g. 25 = 0.25% */
  @IsInt()
  @Min(0)
  @Max(10000)
  vaultFeeBps: number;

  @ValidateNested()
  @Type(() => VaultRolesDto)
  roles: VaultRolesDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VaultAssetDto)
  assets: VaultAssetDto[];

  @IsBoolean()
  @IsOptional()
  upgradable?: boolean;

  @IsString()
  @IsOptional()
  description?: string;
}
