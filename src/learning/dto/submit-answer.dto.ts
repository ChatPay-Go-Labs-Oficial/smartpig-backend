import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class SubmitLearningAnswerDto {
  @IsString()
  @IsNotEmpty()
  optionId: string;

  /** The version actually shown by the client. Stale screens cannot answer. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  contentVersion: number;
}
