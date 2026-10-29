import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { BROADCAST_TYPES, type BroadcastType } from '../broadcast.service';
import { PUSH_PLATFORMS } from './register-device.dto';

/**
 * Limites pensados para a tela bloqueada e para o teto de 4096 bytes do
 * payload do Expo, que título + texto + data cabem com folga.
 */
export class BroadcastDto {
  @ApiProperty({
    enum: BROADCAST_TYPES,
    description:
      'APP_UPDATE_AVAILABLE usa a categoria `updates`; ANNOUNCEMENT, `marketing` (opt-in).',
  })
  @IsIn(BROADCAST_TYPES)
  type: BroadcastType;

  @ApiProperty({ maxLength: 65, example: 'Nova versão do PigFi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(65)
  title: string;

  @ApiProperty({
    maxLength: 240,
    example: 'Atualize o app para ter as novidades.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  body: string;

  @ApiPropertyOptional({
    description: 'Rota interna do app (expo-router). Deve começar com "/".',
    example: '/',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^\/(?!\/)\S*$/, {
    message: 'url must be an internal route starting with a single "/"',
  })
  url?: string;

  @ApiPropertyOptional({ enum: PUSH_PLATFORMS })
  @IsOptional()
  @IsIn(PUSH_PLATFORMS)
  platform?: (typeof PUSH_PLATFORMS)[number];

  @ApiPropertyOptional({
    description:
      'Só usuários com algum device em versão estritamente menor (semver). Devices sem versão conhecida ficam de fora.',
    example: '1.0.13',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?$/, {
    message: 'maxAppVersion must be a semver version (x.y.z)',
  })
  maxAppVersion?: string;

  @ApiPropertyOptional({ description: 'Só conta, não grava nada.' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
