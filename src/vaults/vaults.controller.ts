import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Admin } from '../auth/privy/admin.decorator';
import { AdminOnly } from '../auth/privy/admin-only.decorator';
import { VaultsService } from './vaults.service';

/**
 * The app's api client injects `userId` into the params of every request, and the
 * global ValidationPipe runs with `forbidNonWhitelisted: true`. Any query DTO that
 * omits it turns every call from the app into a 400 — which is why `BalanceQuery`
 * below already declares it.
 */
class VaultListQuery {
  @ApiProperty({
    required: false,
    description:
      'Decides the acknowledgmentRequired hint only. The disclosure rule itself is enforced on deposit.',
  })
  @IsString()
  @IsOptional()
  userId?: string;
}

class BalanceQuery {
  @ApiProperty({
    description: 'The Stellar wallet address to check the balance for',
  })
  @IsString()
  @IsNotEmpty()
  walletAddress: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  userId?: string;
}

@ApiTags('Vaults')
@Admin()
@Controller('vaults')
export class VaultsController {
  constructor(private readonly vaultsService: VaultsService) {}

  @Get()
  @ApiOperation({ summary: 'List all available investment vaults' })
  @ApiResponse({
    status: 200,
    description: 'List of all active vaults.',
    schema: {
      example: [
        {
          id: 'cmp6vault001',
          defindexVaultId: 'CAABC...XYZ',
          name: 'USDC Yield Vault',
          symbol: 'ySAV',
          description: 'Earns yield on USDC via DeFindex strategies',
          apy: '5.23',
          tvl: '1250000.00',
          assetSymbol: 'USDC',
          isActive: true,
          createdAt: '2026-05-15T12:00:00.000Z',
        },
      ],
    },
  })
  listVaults(@Query() query: VaultListQuery) {
    return this.vaultsService.listVaults(query.userId);
  }

  // `@AdminOnly()` sobrepõe o `@Admin()` da classe. As leituras acima são para
  // o app; esta rota é operação, porque o sync sob demanda consome o rate limit
  // compartilhado da DeFindex (ver comentário em vault-sync.job.ts).
  @Post('sync')
  @AdminOnly()
  @ApiOperation({
    summary: 'Trigger vault synchronization',
    description: 'Manually triggers a sync with the Defindex SDK.',
  })
  @ApiResponse({
    status: 201,
    description: 'Synchronization triggered successfully.',
  })
  @ApiResponse({
    status: 502,
    description: 'DeFindex SDK unreachable or returned an error.',
  })
  triggerSync() {
    return this.vaultsService.triggerSync();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get vault details' })
  @ApiParam({
    name: 'id',
    description: 'Vault ID (cuid)',
    example: 'cmp6vault001',
  })
  @ApiResponse({
    status: 200,
    description: 'Vault details returned successfully.',
    schema: {
      example: {
        id: 'cmp6vault001',
        defindexVaultId: 'CAABC...XYZ',
        name: 'USDC Yield Vault',
        symbol: 'ySAV',
        description: 'Earns yield on USDC via DeFindex strategies',
        apy: '5.23',
        tvl: '1250000.00',
        assetSymbol: 'USDC',
        isActive: true,
        createdAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Vault not found.' })
  getVault(@Param('id') id: string, @Query() query: VaultListQuery) {
    return this.vaultsService.getVault(id, query.userId);
  }

  @Get(':id/apy')
  @ApiOperation({ summary: 'Get current vault APY' })
  @ApiParam({
    name: 'id',
    description: 'Vault ID (cuid)',
    example: 'cmp6vault001',
  })
  @ApiResponse({
    status: 200,
    description: 'Current APY for the vault.',
    schema: {
      example: { vaultId: 'cmp6vault001', apy: '5.23' },
    },
  })
  @ApiResponse({ status: 404, description: 'Vault not found.' })
  getVaultApy(@Param('id') id: string) {
    return this.vaultsService.getVaultApy(id);
  }

  @Get(':id/balance')
  @ApiOperation({ summary: 'Get user balance in a specific vault' })
  @ApiParam({
    name: 'id',
    description: 'Vault ID (cuid)',
    example: 'cmp6vault001',
  })
  @ApiQuery({
    name: 'walletAddress',
    description: 'Stellar wallet address to check the balance for',
    example: 'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
  })
  @ApiResponse({
    status: 200,
    description: 'Wallet balance in the specified vault.',
    schema: {
      example: {
        vaultId: 'cmp6vault001',
        walletAddress:
          'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
        balance: '250.000000',
        assetSymbol: 'USDC',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Missing or invalid walletAddress query parameter.',
  })
  @ApiResponse({ status: 404, description: 'Vault not found.' })
  getVaultBalance(@Param('id') id: string, @Query() query: BalanceQuery) {
    return this.vaultsService.getVaultBalance(id, query.walletAddress);
  }
}
