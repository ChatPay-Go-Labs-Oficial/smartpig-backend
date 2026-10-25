import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountOwnerService } from '../auth/privy/account-owner.service';
import { CurrentUser } from '../auth/privy/current-user.decorator';
import { PrivyAuthService } from '../auth/privy/privy-auth.service';
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

  private async localUserId(privyUserId: string): Promise<string> {
    const addresses =
      await this.privyAuthService.getStellarWalletAddresses(privyUserId);
    return this.accountOwner.resolveUserId(addresses);
  }
}
