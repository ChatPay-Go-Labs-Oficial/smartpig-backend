import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateLearningProgressDto {
  @IsString()
  @IsNotEmpty()
  contentItemKey: string;
}
