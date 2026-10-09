import { Module } from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { DepositsController } from './deposits.controller';
import { DefindexModule } from '../defindex/defindex.module';
import { VaultRegistryModule } from '../vault-registry/vault-registry.module';
import { ConversionsModule } from '../conversions/conversions.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DefindexModule, VaultRegistryModule, ConversionsModule, AuthModule],
  providers: [DepositsService],
  controllers: [DepositsController],
  exports: [DepositsService],
})
export class DepositsModule {}
