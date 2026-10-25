import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountOwnerService } from '../auth/privy/account-owner.service';
import { CurrentUser } from '../auth/privy/current-user.decorator';
import { PrivyAuthService } from '../auth/privy/privy-auth.service';
import { ExperienceService } from './experience.service';

@ApiTags('Experience')
@Controller('experience')
export class ExperienceController {
  constructor(
    private readonly experience: ExperienceService,
    private readonly accountOwner: AccountOwnerService,
    private readonly privyAuthService: PrivyAuthService,
  ) {}

  @Post('daily-reward/claim')
  async claimDailyReward(@CurrentUser() user: { id: string }) {
    const addresses = await this.privyAuthService.getStellarWalletAddresses(
      user.id,
    );
    return this.experience.claimDailyReward(
      await this.accountOwner.resolveUserId(addresses),
    );
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get the authenticated user XP, level and rewards' })
  async profile(@CurrentUser() user: { id: string }) {
    const addresses = await this.privyAuthService.getStellarWalletAddresses(
      user.id,
    );
    const userId = await this.accountOwner.resolveUserId(addresses);
    return this.experience.profile(userId);
  }
}
