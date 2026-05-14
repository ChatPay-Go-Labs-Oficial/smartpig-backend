import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { VaultManagerService } from './vault-manager.service';
import { CreateManagedVaultDto } from './dto/create-managed-vault.dto';
import { SubmitManagedVaultDto } from './dto/submit-managed-vault.dto';

@ApiTags('Vault Manager')
@Controller('vault-manager/vaults')
export class VaultManagerController {
  constructor(private readonly vaultManagerService: VaultManagerService) {}

  /**
   * POST /vault-manager/vaults
   * Initiate vault creation via DeFindex factory.
   * Returns an unsigned XDR to be signed by the caller's Stellar wallet.
   */
  @Post()
  @ApiOperation({
    summary: 'Initiate vault creation',
    description:
      'Starts the process of creating a new vault. Returns an unsigned transaction (XDR) to be signed by the user.',
  })
  createVault(@Body() dto: CreateManagedVaultDto) {
    return this.vaultManagerService.createVault(dto);
  }

  /**
   * POST /vault-manager/vaults/:id/submit
   * Submit the signed XDR to confirm vault creation on-chain.
   * Automatically registers the vault in VaultCatalog on success.
   */
  @Post(':id/submit')
  @ApiOperation({
    summary: 'Submit signed vault creation',
    description:
      'Submits the signed transaction to finalize vault creation on-chain.',
  })
  submitVault(@Param('id') id: string, @Body() dto: SubmitManagedVaultDto) {
    return this.vaultManagerService.submitVault(id, dto);
  }

  /**
   * GET /vault-manager/vaults?userId=...
   * List all vaults created by a user.
   */
  @Get()
  @ApiOperation({ summary: 'List managed vaults for a user' })
  listVaults(@Query('userId') userId: string) {
    return this.vaultManagerService.listVaults(userId);
  }

  /**
   * GET /vault-manager/vaults/:id
   * Get details of a specific managed vault.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get managed vault details' })
  getVault(@Param('id') id: string) {
    return this.vaultManagerService.getVault(id);
  }
}
