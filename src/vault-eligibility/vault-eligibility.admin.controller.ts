import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../auth/privy/admin-only.decorator';
import { UpsertVaultEligibilityPolicyDto } from './dto/upsert-vault-eligibility-policy.dto';
import { VaultEligibilityService } from './vault-eligibility.service';

@ApiTags('Vault eligibility admin')
@AdminOnly()
@Controller('admin/vaults/:vaultId/eligibility-policies')
export class VaultEligibilityAdminController {
  constructor(private readonly eligibility: VaultEligibilityService) {}

  @Get()
  @ApiOperation({ summary: 'List education policies for a vault' })
  list(@Param('vaultId') vaultId: string) {
    return this.eligibility.listPolicies(vaultId);
  }

  @Post()
  @ApiOperation({ summary: 'Create or update a versioned education policy' })
  upsert(
    @Param('vaultId') vaultId: string,
    @Body() dto: UpsertVaultEligibilityPolicyDto,
  ) {
    return this.eligibility.upsertPolicy(vaultId, dto);
  }
}
