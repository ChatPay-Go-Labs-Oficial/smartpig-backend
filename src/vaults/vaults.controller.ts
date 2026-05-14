import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { VaultsService } from './vaults.service';

class BalanceQuery {
  @ApiProperty({
    description: 'The Stellar wallet address to check the balance for',
  })
  @IsString()
  @IsNotEmpty()
  walletAddress: string;
}

@ApiTags('Vaults')
@Controller('vaults')
export class VaultsController {
  constructor(private readonly vaultsService: VaultsService) {}

  @Get()
  @ApiOperation({ summary: 'List all available investment vaults' })
  listVaults() {
    return this.vaultsService.listVaults();
  }

  @Post('sync')
  @ApiOperation({
    summary: 'Trigger vault synchronization',
    description: 'Manually triggers a sync with the Defindex SDK.',
  })
  triggerSync() {
    return this.vaultsService.triggerSync();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get vault details' })
  getVault(@Param('id') id: string) {
    return this.vaultsService.getVault(id);
  }

  @Get(':id/apy')
  @ApiOperation({ summary: 'Get current vault APY' })
  getVaultApy(@Param('id') id: string) {
    return this.vaultsService.getVaultApy(id);
  }

  @Get(':id/balance')
  @ApiOperation({ summary: 'Get user balance in a specific vault' })
  getVaultBalance(@Param('id') id: string, @Query() query: BalanceQuery) {
    return this.vaultsService.getVaultBalance(id, query.walletAddress);
  }
}
