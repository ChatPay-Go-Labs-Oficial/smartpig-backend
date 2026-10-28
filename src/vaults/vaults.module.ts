import { Module } from '@nestjs/common';
import { VaultsService } from './vaults.service';
import { VaultsController } from './vaults.controller';
import { DefindexModule } from '../defindex/defindex.module';
import { VaultSyncJob } from '../jobs/vault-sync.job';
import { VaultRegistryModule } from '../vault-registry/vault-registry.module';
import { VaultEligibilityModule } from '../vault-eligibility/vault-eligibility.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    DefindexModule,
    VaultRegistryModule,
    VaultEligibilityModule,
    AuthModule,
  ],
  providers: [VaultsService, VaultSyncJob],
  controllers: [VaultsController],
  exports: [VaultsService],
})
export class VaultsModule {}
