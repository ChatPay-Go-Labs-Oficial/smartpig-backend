import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountOwnerService } from '../auth/privy/account-owner.service';
import { CurrentUser } from '../auth/privy/current-user.decorator';
import { PrivyAuthService } from '../auth/privy/privy-auth.service';
import { SubmitLearningAnswerDto } from './dto/submit-answer.dto';
import { UpdateLearningProgressDto } from './dto/update-learning-progress.dto';
import { LearningService } from './learning.service';

@ApiTags('Learning')
@Controller('learning')
export class LearningController {
  constructor(
    private readonly learning: LearningService,
    private readonly accountOwner: AccountOwnerService,
    private readonly privyAuthService: PrivyAuthService,
  ) {}

  @Get('content')
  @ApiOperation({ summary: 'Get welcome, habit practices and glossary' })
  async content(@CurrentUser() user: { id: string }) {
    await this.localUserId(user.id);
    return this.learning.listStandaloneContent();
  }

  @Get('modules')
  @ApiOperation({ summary: 'List published learning modules and progress' })
  async modules(@CurrentUser() user: { id: string }) {
    return this.learning.listModules(await this.localUserId(user.id));
  }

  @Get('modules/:moduleKey')
  @ApiOperation({ summary: 'Get module content without answer keys' })
  async module(
    @Param('moduleKey') moduleKey: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.learning.getModule(await this.localUserId(user.id), moduleKey);
  }

  @Patch('modules/:moduleKey/progress')
  @ApiOperation({ summary: 'Save the last viewed content item for resume' })
  async markContent(
    @Param('moduleKey') moduleKey: string,
    @Body() dto: UpdateLearningProgressDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.learning.markContent(
      await this.localUserId(user.id),
      moduleKey,
      dto.contentItemKey,
    );
  }

  @Post('questions/:questionKey/answer')
  @ApiOperation({
    summary: 'Validate an answer and grant first-correct XP atomically',
  })
  async answer(
    @Param('questionKey') questionKey: string,
    @Body() dto: SubmitLearningAnswerDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.learning.submitAnswer(
      await this.localUserId(user.id),
      questionKey,
      dto.optionId,
      dto.contentVersion,
    );
  }

  @Get('progress')
  @ApiOperation({ summary: 'Get XP and learning progress for resume' })
  async progress(@CurrentUser() user: { id: string }) {
    return this.learning.progress(await this.localUserId(user.id));
  }

  private async localUserId(privyUserId: string): Promise<string> {
    const addresses =
      await this.privyAuthService.getStellarWalletAddresses(privyUserId);
    return this.accountOwner.resolveUserId(addresses);
  }
}
