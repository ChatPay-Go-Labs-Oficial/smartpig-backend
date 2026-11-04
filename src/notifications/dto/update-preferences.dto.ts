import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** PATCH parcial: qualquer subconjunto das quatro chaves. */
export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({
    description: 'Depósitos, saques, cofres, presentes e cadastro',
  })
  @IsOptional()
  @IsBoolean()
  transactions?: boolean;

  @ApiPropertyOptional({ description: 'Novas versões do app' })
  @IsOptional()
  @IsBoolean()
  updates?: boolean;

  @ApiPropertyOptional({ description: 'Novidades e promoções (opt-in)' })
  @IsOptional()
  @IsBoolean()
  marketing?: boolean;

  @ApiPropertyOptional({
    description: 'Mostrar valor e @username no texto do push',
  })
  @IsOptional()
  @IsBoolean()
  showDetails?: boolean;
}
