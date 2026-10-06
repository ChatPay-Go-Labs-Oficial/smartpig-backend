import { Module } from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { DepositsController } from './deposits.controller';
import { DefindexModule } from '../defindex/defindex.module';
import { VaultRegistryModule } from '../vault-registry/vault-registry.module';

@Module({
  imports: [DefindexModule, VaultRegistryModule],
  providers: [DepositsService],
  controllers: [DepositsController],
  exports: [DepositsService],
})
export class DepositsModule {}
