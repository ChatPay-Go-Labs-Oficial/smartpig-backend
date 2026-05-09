import { Module } from '@nestjs/common';
import { VaultsService } from './vaults.service';
import { VaultsController } from './vaults.controller';
import { DefindexModule } from '../defindex/defindex.module';
import { VaultSyncJob } from '../jobs/vault-sync.job';

@Module({
  imports: [DefindexModule],
  providers: [VaultsService, VaultSyncJob],
  controllers: [VaultsController],
  exports: [VaultsService],
})
export class VaultsModule {}
