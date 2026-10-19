import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, Matches } from 'class-validator';

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * `storeUrl` é o destino da tela de update obrigatório, que o app abre para
 * todos os usuários quando `minVersion` sobe. `@IsUrl()` sozinho aceita qualquer
 * domínio, então o destino é restrito às lojas oficiais.
 */
const STORE_URL_PATTERN =
  /^https:\/\/(apps\.apple\.com|itunes\.apple\.com|play\.google\.com)\//;

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
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @IsOptional()
  @Matches(STORE_URL_PATTERN, {
    message: 'storeUrl deve apontar para a App Store ou a Play Store via https',
  })
  storeUrl?: string;
}
