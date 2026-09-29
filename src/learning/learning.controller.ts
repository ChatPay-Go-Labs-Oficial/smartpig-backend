import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/privy/current-user.decorator';
import { LearningService } from './learning.service';

export class AnswerQuestionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  questionId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  optionId: string;

  @IsInt()
  @Min(1)
  version: number;
}

@ApiTags('Learning')
@Controller('learning')
export class LearningController {
  constructor(private readonly learning: LearningService) {}

  @Get('lessons')
  lessons() {
    return this.learning.catalog();
  }

  @Get('progress')
  async progress(@CurrentUser() user: { id: string }) {
    return this.learning.progress(await this.learning.resolveUserId(user.id));
  }

  @Post('lessons/:id/answers')
  async answer(
    @CurrentUser() user: { id: string },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AnswerQuestionDto,
  ) {
    return this.learning.answer(
      await this.learning.resolveUserId(user.id),
      id,
      dto.questionId,
      dto.optionId,
      dto.version,
    );
  }
}
