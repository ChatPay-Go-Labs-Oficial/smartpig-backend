import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { VaultsService } from './vaults.service';
import { IsNotEmpty, IsString } from 'class-validator';

class BalanceQuery {
  @IsString()
  @IsNotEmpty()
  walletAddress: string;
}

@Controller('vaults')
export class VaultsController {
  constructor(private readonly vaultsService: VaultsService) {}

  @Get()
  listVaults() {
    return this.vaultsService.listVaults();
  }

  @Post('sync')
  triggerSync() {
    return this.vaultsService.triggerSync();
  }

  @Get(':id')
  getVault(@Param('id') id: string) {
    return this.vaultsService.getVault(id);
  }

  @Get(':id/apy')
  getVaultApy(@Param('id') id: string) {
    return this.vaultsService.getVaultApy(id);
  }

  @Get(':id/balance')
  getVaultBalance(@Param('id') id: string, @Query() query: BalanceQuery) {
    return this.vaultsService.getVaultBalance(id, query.walletAddress);
  }
}
