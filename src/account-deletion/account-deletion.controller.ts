import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/privy/current-user.decorator';
import { AccountOwnerService } from '../auth/privy/account-owner.service';
import { PrivyAuthService } from '../auth/privy/privy-auth.service';
import { EligibilityService } from './eligibility.service';
import { EligibilityResult } from './dto/eligibility.dto';

@ApiTags('Account deletion')
@Controller('account-deletion')
export class AccountDeletionController {
  constructor(
    private readonly eligibility: EligibilityService,
    private readonly accountOwner: AccountOwnerService,
    private readonly privyAuthService: PrivyAuthService,
  ) {}

  /**
   * GET /account-deletion/eligibility
   *
   * The account under inspection comes from the token, never from the request. The
   * app's api client injects a `userId` into every call; this route ignores it.
   */
  @Get('eligibility')
  @ApiOperation({ summary: 'Check whether the account can be deleted' })
  @ApiResponse({
    status: 200,
    description: 'Eligibility, blockers, residual balances and warnings.',
  })
  @ApiResponse({
    status: 404,
    description: 'No active account for this token.',
  })
  async getEligibility(
    @CurrentUser() user: { id: string },
  ): Promise<EligibilityResult> {
    const verifiedStellarAddresses =
      await this.privyAuthService.getStellarWalletAddresses(user.id);
    const userId = await this.accountOwner.resolveUserId(
      verifiedStellarAddresses,
    );
    return this.eligibility.check(userId);
  }
}
