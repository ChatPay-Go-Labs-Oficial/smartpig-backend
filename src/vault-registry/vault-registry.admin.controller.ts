import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../auth/privy/admin-only.decorator';
import { VaultRegistryAdminService } from './vault-registry.admin.service';
import {
  CreateDisclosureDto,
  ImportVaultDto,
  UpdateVaultRegistryDto,
} from './dto/update-vault-registry.dto';

/**
 * Operator controls for the vault registry.
 *
 * `@AdminOnly()` and not `@Admin()`: the latter accepts the admin key *or* falls
 * through to bearer auth, so every logged-in user would reach these routes. What
 * is decided here — which vaults exist, which take deposits, and what risks are
 * disclosed — is not a user-level decision.
 *
 * Everything here changes behaviour at runtime, with no mobile release and no
 * redeploy, and none of it touches DeFindex contract code or strategy logic.
 */
@ApiTags('Vault Registry (admin)')
@AdminOnly()
@Controller('admin/vaults')
export class VaultRegistryAdminController {
  constructor(private readonly admin: VaultRegistryAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'List every vault, including inactive ones',
    description:
      'Shows curated and discovered metadata side by side, plus the currently ' +
      'published disclosure version.',
  })
  listAll() {
    return this.admin.listAll();
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Activate, deactivate, pause deposits, or edit vault metadata',
    description:
      'Activating a non-USDC vault requires a published disclosure. Editing display ' +
      'metadata marks the row curated so the discovery job stops overwriting it.',
  })
  @ApiParam({ name: 'id', description: 'VaultCatalog id (cuid)' })
  @ApiResponse({ status: 200, description: 'Updated.' })
  @ApiResponse({ status: 404, description: 'Vault not found.' })
  @ApiResponse({
    status: 409,
    description: 'Non-USDC activation attempted with no published disclosure.',
  })
  update(@Param('id') id: string, @Body() dto: UpdateVaultRegistryDto) {
    return this.admin.update(id, dto);
  }

  @Post('import')
  @ApiOperation({
    summary: 'Register a vault deployed by DeFindex',
    description:
      'For vaults we did not instantiate. Lands inactive; listing is a separate step.',
  })
  @ApiResponse({ status: 201, description: 'Registered, inactive.' })
  @ApiResponse({ status: 409, description: 'Already registered.' })
  import(@Body() dto: ImportVaultDto) {
    return this.admin.import(dto);
  }

  @Get(':id/disclosures')
  @ApiOperation({ summary: 'List every disclosure version of a vault' })
  @ApiParam({ name: 'id', description: 'VaultCatalog id (cuid)' })
  listDisclosures(@Param('id') id: string) {
    return this.admin.listDisclosures(id);
  }

  @Post(':id/disclosures')
  @ApiOperation({
    summary: 'Create a disclosure version',
    description:
      'Risks are validated against the known RiskCode set. Omit `version` to take ' +
      'the next one. Publishing a new version makes every user acknowledge again.',
  })
  @ApiParam({ name: 'id', description: 'VaultCatalog id (cuid)' })
  @ApiResponse({ status: 201, description: 'Created.' })
  @ApiResponse({
    status: 409,
    description: 'Version exists, or risks invalid.',
  })
  createDisclosure(@Param('id') id: string, @Body() dto: CreateDisclosureDto) {
    return this.admin.createDisclosure(id, dto);
  }

  @Post(':id/disclosures/:version/publish')
  @ApiOperation({
    summary: 'Publish a disclosure version',
    description:
      'Idempotent: republishing keeps the original timestamp, which is the moment ' +
      'the text became binding.',
  })
  @ApiParam({ name: 'id', description: 'VaultCatalog id (cuid)' })
  @ApiParam({ name: 'version', description: 'Disclosure version (integer)' })
  publishDisclosure(
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.admin.publishDisclosure(id, version);
  }
}
