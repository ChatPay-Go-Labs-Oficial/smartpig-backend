import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpsertVaultEligibilityPolicyDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  minimumLevel: number;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  requiredModuleKeys: string[];

  @IsBoolean()
  publish: boolean;
}
