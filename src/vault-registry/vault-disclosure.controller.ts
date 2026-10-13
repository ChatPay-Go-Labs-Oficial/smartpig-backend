import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/privy/current-user.decorator';
import { AccountOwnerService } from '../auth/privy/account-owner.service';
import { PrivyAuthService } from '../auth/privy/privy-auth.service';
import { DisclosureService } from './disclosure.service';
import { AcknowledgeDisclosureDto } from './dto/acknowledge-disclosure.dto';

/**
 * The user-facing half of the risk disclosures: read the current one, accept it.
 *
 * A separate controller from `VaultsController` on purpose. That one is `@Admin()`
 * at class level, so the admin key is accepted as an alternative credential and
 * `request.user` becomes `{ id: 'admin' }` — fine for reading vault data, wrong for
 * a consent record, which must belong to a real person.
 *
 * The account is therefore always derived from the token, never from the request.
 * The app's api client injects a `userId` into every call; here it is only ever
 * compared against the real owner, never trusted as the answer.
 */
@ApiTags('Vault risk disclosures')
@Controller('vaults')
export class VaultDisclosureController {
  constructor(
    private readonly disclosures: DisclosureService,
    private readonly accountOwner: AccountOwnerService,
    private readonly privyAuthService: PrivyAuthService,
  ) {}

  @Get(':id/disclosure')
  @ApiOperation({
    summary: 'The current risk disclosure for a vault, and whether it is owed',
    description:
      'Risks come as structured codes plus params; the app writes the wording so ' +
      'it matches the Lite/Pro mode. `fallbackText`, when present, covers a code ' +
      'the installed build does not know yet.',
  })
  @ApiParam({ name: 'id', description: 'VaultCatalog id (cuid)' })
  @ApiResponse({ status: 200, description: 'Current disclosure.' })
  @ApiResponse({
    status: 404,
    description: 'No published disclosure for this vault.',
  })
  async getDisclosure(
    @Param('id') vaultId: string,
    @CurrentUser() user: { id: string },
  ) {
    const userId = await this.resolveOwner(user.id);
    const { acknowledged, current } =
      await this.disclosures.hasAcknowledgedCurrent(userId, vaultId);

    if (!current) {
      return { vaultId, disclosure: null, acknowledgmentRequired: false };
    }

    return {
      vaultId,
      disclosure: {
        version: current.version,
        risks: current.risks,
        sections: current.sections,
        publishedAt: current.publishedAt,
      },
      acknowledgmentRequired: !acknowledged,
    };
  }

  @Post(':id/disclosure/acknowledge')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Record that the user accepted the current disclosure',
    description:
      'Idempotent per user, vault and version. Send `version` to be told when a ' +
      'newer one was published while the sheet was open, instead of recording ' +
      'consent against text nobody read.',
  })
  @ApiParam({ name: 'id', description: 'VaultCatalog id (cuid)' })
  @ApiResponse({ status: 201, description: 'Acknowledgment recorded.' })
  @ApiResponse({
    status: 409,
    description: 'The submitted version is no longer current.',
  })
  async acknowledge(
    @Param('id') vaultId: string,
    @Body() dto: AcknowledgeDisclosureDto,
    @CurrentUser() user: { id: string },
  ) {
    const userId = await this.resolveOwner(user.id);

    return this.disclosures.acknowledge({
      userId,
      vaultId,
      expectedVersion: dto.version,
      context: {
        appVersion: dto.appVersion,
        mode: dto.mode,
        shownCodes: dto.shownCodes,
      },
    });
  }

  /** The account always comes from the token, never from the request. */
  private async resolveOwner(privyUserId: string): Promise<string> {
    const verifiedStellarAddresses =
      await this.privyAuthService.getStellarWalletAddresses(privyUserId);
    return this.accountOwner.resolveUserId(verifiedStellarAddresses);
  }
}
