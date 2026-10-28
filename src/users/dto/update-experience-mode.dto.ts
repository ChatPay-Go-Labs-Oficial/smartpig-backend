import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const EXPERIENCE_MODES = ['LITE', 'PRO'] as const;
export type ExperienceModeValue = (typeof EXPERIENCE_MODES)[number];

export class UpdateExperienceModeDto {
  @ApiProperty({
    enum: EXPERIENCE_MODES,
    description:
      'Experience vocabulary. LITE enables the educational path; PRO preserves the established product flow.',
  })
  @IsIn(EXPERIENCE_MODES)
  mode: ExperienceModeValue;
}
