import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Admin } from '../auth/privy/admin.decorator';
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
  @Admin()
  @ApiOperation({
    summary: 'Initiate vault creation',
    description:
      'Starts the process of creating a new vault. Returns an unsigned transaction (XDR) to be signed by the user.',
  })
  @ApiResponse({
    status: 201,
    description: 'Vault creation initiated. The unsignedXdr must be signed and submitted back.',
    schema: {
      example: {
        id: 'cmp7vault001',
        userId: 'nuw8uz50x4swu6b476uf4lla',
        name: 'Smart Savings Vault',
        symbol: 'sSAV',
        status: 'PENDING_SIGNATURE',
        unsignedXdr: 'AAAAAgAAAAB...',
        defindexVaultId: null,
        createdAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request body (e.g. missing name or symbol).' })
  @ApiResponse({ status: 409, description: 'A vault with the same symbol already exists.' })
  createVault(@Body() dto: CreateManagedVaultDto) {
    return this.vaultManagerService.createVault(dto);
  }

  /**
   * POST /vault-manager/vaults/:id/submit
   * Submit the signed XDR to confirm vault creation on-chain.
   * Automatically registers the vault in VaultCatalog on success.
   */
  @Post(':id/submit')
  @Admin()
  @ApiOperation({
    summary: 'Submit signed vault creation',
    description:
      'Submits the signed transaction to finalize vault creation on-chain.',
  })
  @ApiParam({ name: 'id', description: 'Managed vault ID (cuid)', example: 'cmp7vault001' })
  @ApiResponse({
    status: 201,
    description: 'Vault creation confirmed on-chain.',
    schema: {
      example: {
        id: 'cmp7vault001',
        userId: 'nuw8uz50x4swu6b476uf4lla',
        name: 'Smart Savings Vault',
        symbol: 'sSAV',
        status: 'CONFIRMED',
        defindexVaultId: 'CAABC...XYZ',
        createdAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid or missing signedXdr in request body.' })
  @ApiResponse({ status: 404, description: 'Managed vault not found.' })
  @ApiResponse({ status: 409, description: 'Vault is not in the expected PENDING_SIGNATURE state.' })
  submitVault(@Param('id') id: string, @Body() dto: SubmitManagedVaultDto) {
    return this.vaultManagerService.submitVault(id, dto);
  }

  /**
   * GET /vault-manager/vaults?userId=...
   * List all vaults created by a user.
   */
  @Get()
  @Admin()
  @ApiOperation({ summary: 'List managed vaults for a user' })
  @ApiQuery({ name: 'userId', description: 'ID of the user whose managed vaults to list', example: 'nuw8uz50x4swu6b476uf4lla' })
  @ApiResponse({
    status: 200,
    description: 'List of managed vaults for the user.',
    schema: {
      example: [
        {
          id: 'cmp7vault001',
          userId: 'nuw8uz50x4swu6b476uf4lla',
          name: 'Smart Savings Vault',
          symbol: 'sSAV',
          status: 'CONFIRMED',
          defindexVaultId: 'CAABC...XYZ',
          createdAt: '2026-05-15T12:00:00.000Z',
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Missing userId query parameter.' })
  listVaults(@Query('userId') userId: string) {
    return this.vaultManagerService.listVaults(userId);
  }

  /**
   * GET /vault-manager/vaults/:id
   * Get details of a specific managed vault.
   */
  @Get(':id')
  @Admin()
  @ApiOperation({ summary: 'Get managed vault details' })
  @ApiParam({ name: 'id', description: 'Managed vault ID (cuid)', example: 'cmp7vault001' })
  @ApiResponse({
    status: 200,
    description: 'Managed vault details returned successfully.',
    schema: {
      example: {
        id: 'cmp7vault001',
        userId: 'nuw8uz50x4swu6b476uf4lla',
        name: 'Smart Savings Vault',
        symbol: 'sSAV',
        status: 'CONFIRMED',
        defindexVaultId: 'CAABC...XYZ',
        createdAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Managed vault not found.' })
  getVault(@Param('id') id: string) {
    return this.vaultManagerService.getVault(id);
  }
}
