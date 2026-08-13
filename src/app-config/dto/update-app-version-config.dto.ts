import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, Matches } from 'class-validator';

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

export class UpdateAppVersionConfigDto {
  @ApiProperty({
    description:
      'Versão mínima obrigatória (semver x.y.z). Abaixo dela, o app bloqueia o uso.',
    example: '1.2.0',
    required: false,
  })
  @IsString()
  @IsOptional()
  @Matches(SEMVER_PATTERN, {
    message: 'minVersion deve seguir o formato x.y.z',
  })
  minVersion?: string;

  @ApiProperty({
    description:
      'Versão recomendada/mais recente (semver x.y.z). Mostra banner dispensável.',
    example: '1.3.0',
    required: false,
  })
  @IsString()
  @IsOptional()
  @Matches(SEMVER_PATTERN, {
    message: 'latestVersion deve seguir o formato x.y.z',
  })
  latestVersion?: string;

  @ApiProperty({
    description: 'URL da loja (App Store / Play Store) para essa plataforma',
    required: false,
  })
  @IsUrl()
  @IsOptional()
  storeUrl?: string;
}
