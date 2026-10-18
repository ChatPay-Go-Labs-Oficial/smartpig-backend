import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/privy/current-user.decorator';
import { AccountOwnerService } from '../auth/privy/account-owner.service';
import { PrivyAuthService } from '../auth/privy/privy-auth.service';
import { PortfolioService } from './portfolio.service';

@ApiTags('Portfolio')
@Controller('portfolio')
export class PortfolioController {
  constructor(
    private readonly portfolio: PortfolioService,
    private readonly accountOwner: AccountOwnerService,
    private readonly privyAuthService: PrivyAuthService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Holdings across every vault, valued in USD',
    description:
      'One request in place of the client reading each vault and summing the ' +
      'amounts as if they shared a currency. `totalUsd` is null when any held ' +
      'position could not be priced — a partial total looks complete and ' +
      'understates what the user has.',
  })
  @ApiResponse({
    status: 200,
    description: 'Total, source, and per-vault positions.',
  })
  @ApiResponse({
    status: 404,
    description: 'No active wallet for this account.',
  })
  async summary(@CurrentUser() user: { id: string }) {
    const verifiedStellarAddresses =
      await this.privyAuthService.getStellarWalletAddresses(user.id);
    const userId = await this.accountOwner.resolveUserId(
      verifiedStellarAddresses,
    );
    return this.portfolio.summary(userId);
  }
}
