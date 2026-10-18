import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/privy/current-user.decorator';
import { AccountOwnerService } from '../auth/privy/account-owner.service';
import { PrivyAuthService } from '../auth/privy/privy-auth.service';
import { ConversionsService } from './conversions.service';
import {
  CreateConversionDto,
  PendingConversionsQuery,
  QuoteConversionDto,
  SubmitConversionDto,
} from './dto/conversion.dto';

/**
 * Converting supported wallet assets on the Stellar DEX.
 *
 * The ramp delivers USDC; the EURC and XLM vaults want their own asset. A classic
 * `pathPaymentStrictSend` bridges the two against the order book, so the
 * counterparty is the market and PigFi holds no inventory.
 *
 * It is a separate transaction from the deposit, and must be: a path payment is a
 * classic operation while a DeFindex deposit is Soroban, which admits exactly one
 * operation per transaction. The deposit is also generated only after this
 * confirms, because DeFindex simulates the account state when it builds that XDR.
 *
 * The account comes from the token, never from the request — this moves the user's
 * funds.
 */
@ApiTags('Asset conversion')
@Controller('conversions')
export class ConversionsController {
  constructor(
    private readonly conversions: ConversionsService,
    private readonly accountOwner: AccountOwnerService,
    private readonly privyAuthService: PrivyAuthService,
  ) {}

  @Get('quote')
  @ApiOperation({
    summary: 'Price a conversion without creating anything',
    description:
      'Returns the estimate and the minimum the on-chain operation will accept. ' +
      'Below that minimum the payment fails atomically and the user keeps their ' +
      'funds, so they can never be given a bad rate silently.',
  })
  @ApiResponse({ status: 200, description: 'Quote with estimate and floor.' })
  @ApiResponse({
    status: 503,
    description: 'No route right now, or conversion is turned off.',
  })
  async quote(@Query() query: QuoteConversionDto) {
    return this.conversions.quote({
      fromSymbol: query.from,
      toSymbol: query.to,
      amount: query.amount,
    });
  }

  @Get('pending')
  @ApiOperation({
    summary: 'Conversions that landed but whose deposit never happened',
    description:
      'The user holds the converted asset and still owes the deposit. Surfacing ' +
      'these is what keeps the balance from looking unexplained.',
  })
  async pending(
    @Query() _query: PendingConversionsQuery,
    @CurrentUser() user: { id: string },
  ) {
    const userId = await this.resolveOwner(user.id);
    return this.conversions.listPending(userId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a conversion and get the XDR to authorize',
    description:
      'Requires an active trustline for the target asset; returns 409 with the ' +
      'trustline XDR when one is missing, since a payment into an untrusted ' +
      'asset fails with op_no_trust.',
  })
  @ApiResponse({ status: 201, description: 'Intent created, with the XDR.' })
  @ApiResponse({
    status: 409,
    description: 'The target asset needs a trustline.',
  })
  async create(
    @Body() dto: CreateConversionDto,
    @CurrentUser() user: { id: string },
  ) {
    const userId = await this.resolveOwner(user.id);
    return this.conversions.createConversion({
      idempotencyKey: dto.idempotencyKey,
      userId,
      walletAccountId: dto.walletAccountId,
      fromSymbol: dto.from,
      toSymbol: dto.to,
      amount: dto.amount,
      plannedDeposit: dto.vaultId
        ? { vaultId: dto.vaultId, assetSymbol: dto.to }
        : undefined,
    });
  }

  @Post(':id/signed-xdr')
  @ApiOperation({
    summary: 'Submit the signed conversion',
    description:
      'Submitted through the Treasury fee bump, which pins the hash to the XDR ' +
      'we issued. The amount recorded is read from the transaction effects, not ' +
      'from the quote — the deposit that follows is sized by what arrived.',
  })
  @ApiParam({ name: 'id', description: 'AssetConversion id (cuid)' })
  @ApiResponse({ status: 201, description: 'Confirmed, with the tx hash.' })
  @ApiResponse({ status: 409, description: 'Already submitted or confirmed.' })
  async submit(
    @Param('id') id: string,
    @Body() dto: SubmitConversionDto,
    @CurrentUser() user: { id: string },
  ) {
    const userId = await this.resolveOwner(user.id);
    return this.conversions.submitConversion({
      id,
      userId,
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
