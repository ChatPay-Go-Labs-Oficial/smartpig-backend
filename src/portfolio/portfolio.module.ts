import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DefindexModule } from '../defindex/defindex.module';
import { VaultRegistryModule } from '../vault-registry/vault-registry.module';
import { PricingModule } from '../pricing/pricing.module';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';

@Module({
  imports: [AuthModule, DefindexModule, VaultRegistryModule, PricingModule],
  providers: [PortfolioService],
  controllers: [PortfolioController],
  exports: [PortfolioService],
})
export class PortfolioModule {}
