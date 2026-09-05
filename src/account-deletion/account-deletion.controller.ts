import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/privy/current-user.decorator';
import { AccountOwnerService } from '../auth/privy/account-owner.service';
import { PrivyAuthService } from '../auth/privy/privy-auth.service';
import { EligibilityService } from './eligibility.service';
import { AccountDeletionService } from './account-deletion.service';
import { ConfirmDeletionDto, RequestDeletionDto } from './dto/deletion.dto';
import type {
  ConfirmDeletionResult,
  RequestDeletionResult,
} from './dto/deletion.dto';
import { EligibilityResult } from './dto/eligibility.dto';

@ApiTags('Account deletion')
@Controller('account-deletion')
export class AccountDeletionController {
  constructor(
    private readonly eligibility: EligibilityService,
    private readonly deletion: AccountDeletionService,
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

  /**
   * POST /account-deletion
   *
   * Re-validates eligibility, records the request and builds the closure
   * transaction for the user to sign. Nothing is destroyed here — a request left
   * unconfirmed simply expires.
   */
  @Post()
  @ApiOperation({ summary: 'Open an account deletion request' })
  @ApiResponse({
    status: 201,
    description: 'Request created; sign the XDR to confirm.',
  })
  @ApiResponse({ status: 409, description: 'Account is no longer eligible.' })
  async requestDeletion(
    @CurrentUser() user: { id: string },
    @Body() dto: RequestDeletionDto,
  ): Promise<RequestDeletionResult> {
    const userId = await this.resolveOwner(user.id);
    return this.deletion.requestDeletion(userId, dto.idempotencyKey);
  }

  /**
   * POST /account-deletion/:id/confirm
   *
   * Runs the saga. From here the deletion is irreversible.
   */
  @Post(':id/confirm')
  @ApiOperation({ summary: 'Confirm and execute the account deletion' })
  @ApiResponse({ status: 200, description: 'Deleted, or already deleted.' })
  @ApiResponse({
    status: 400,
    description: 'Missing acknowledgements or signature.',
  })
  @ApiResponse({
    status: 403,
    description: 'The request belongs to another account.',
  })
  @ApiResponse({
    status: 409,
    description: 'No longer eligible, or request already failed.',
  })
  @ApiResponse({
    status: 503,
    description: 'On-chain closure failed; safe to retry.',
  })
  async confirmDeletion(
    @CurrentUser() user: { id: string },
    @Param('id') requestId: string,
    @Body() dto: ConfirmDeletionDto,
  ): Promise<ConfirmDeletionResult> {
    const userId = await this.resolveOwner(user.id);
    return this.deletion.confirmDeletion(userId, user.id, requestId, dto);
  }

  /** The account under operation always comes from the token, never the request. */
  private async resolveOwner(privyUserId: string): Promise<string> {
    const verifiedStellarAddresses =
      await this.privyAuthService.getStellarWalletAddresses(privyUserId);
    return this.accountOwner.resolveUserId(verifiedStellarAddresses);
  }
}
