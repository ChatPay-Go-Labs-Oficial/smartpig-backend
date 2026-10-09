import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/privy/current-user.decorator';
import { AccountOwnerService } from '../auth/privy/account-owner.service';
import { PrivyAuthService } from '../auth/privy/privy-auth.service';
import { TrustlinesService } from './trustlines.service';
import { EnsureTrustlineDto, SubmitTrustlineDto } from './dto/trustline.dto';

/**
 * On-demand trustlines for assets outside onboarding.
 *
 * A deposit into a non-funding asset needs its trustline first, and opening one
 * reserves 0.5 XLM that our wallets do not have — so the Treasury sponsors it and
 * the user only adds a signature.
 *
 * The account comes from the token, never from the request. These routes change
 * on-chain state for a specific wallet, so a valid token for one user must not
 * reach another's.
 */
@ApiTags('Wallet trustlines')
@Controller('wallets/:walletAccountId/trustlines')
export class TrustlinesController {
  constructor(
    private readonly trustlines: TrustlinesService,
    private readonly accountOwner: AccountOwnerService,
    private readonly privyAuthService: PrivyAuthService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Trustlines recorded for this wallet' })
  @ApiParam({ name: 'walletAccountId', description: 'WalletAccount id (cuid)' })
  async list(
    @Param('walletAccountId') walletAccountId: string,
    @CurrentUser() user: { id: string },
  ) {
    const userId = await this.resolveOwner(user.id);
    return this.trustlines.listTrustlines(userId, walletAccountId);
  }

  @Post()
  @ApiOperation({
    summary: 'Whether a trustline is needed, with the sponsored XDR when it is',
    description:
      'Returns `required: false` when the line already exists — that is the ' +
      'normal answer on repeat deposits, not an error. The XDR comes pre-signed ' +
      'by the Treasury, which sponsors the reserve.',
  })
  @ApiParam({ name: 'walletAccountId', description: 'WalletAccount id (cuid)' })
  @ApiResponse({
    status: 201,
    description: 'Requirement, and the XDR if needed.',
  })
  @ApiResponse({ status: 404, description: 'Wallet not found for this user.' })
  @ApiResponse({
    status: 409,
    description: 'The wallet has not been activated yet.',
  })
  async ensure(
    @Param('walletAccountId') walletAccountId: string,
    @Body() dto: EnsureTrustlineDto,
    @CurrentUser() user: { id: string },
  ) {
    const userId = await this.resolveOwner(user.id);
    return this.trustlines.ensureTrustline({
      userId,
      walletAccountId,
      assetSymbol: dto.assetSymbol,
    });
  }

  @Post('submit')
  @ApiOperation({
    summary: 'Submit the signed trustline transaction',
    description:
      'Submitted through the Treasury fee bump, which pins the hash to the XDR ' +
      'we issued: the client may add a signature and nothing else. Idempotent ' +
      'once the trustline is active.',
  })
  @ApiParam({ name: 'walletAccountId', description: 'WalletAccount id (cuid)' })
  @ApiResponse({
    status: 201,
    description: 'Trustline active, with the tx hash.',
  })
  @ApiResponse({
    status: 400,
    description: 'No trustline transaction was issued for this asset.',
  })
  async submit(
    @Param('walletAccountId') walletAccountId: string,
    @Body() dto: SubmitTrustlineDto,
    @CurrentUser() user: { id: string },
  ) {
    const userId = await this.resolveOwner(user.id);
    return this.trustlines.submitTrustline({
      userId,
      walletAccountId,
      assetSymbol: dto.assetSymbol,
      signedXdr: dto.signedXdr,
    });
  }

  /** The account always comes from the token, never from the request. */
  private async resolveOwner(privyUserId: string): Promise<string> {
    const verifiedStellarAddresses =
      await this.privyAuthService.getStellarWalletAddresses(privyUserId);
    return this.accountOwner.resolveUserId(verifiedStellarAddresses);
  }
}
