import { Module } from '@nestjs/common';
import { DefindexConfig } from './defindex.config';
import { DefindexService } from './defindex.service';
import { DefindexMapper } from './defindex.mapper';
import { DefindexOrchestrator } from './defindex.orchestrator';
import { DefindexVaultAdapter } from './defindex-vault.adapter';
import { VaultAdapterRegistry } from './adapter.registry';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [WalletsModule],
  providers: [
    DefindexConfig,
    DefindexService,
    DefindexMapper,
    DefindexOrchestrator,
    DefindexVaultAdapter,
    VaultAdapterRegistry,
  ],
  exports: [
    DefindexService,
    DefindexOrchestrator,
    DefindexVaultAdapter,
    VaultAdapterRegistry,
  ],
})
export class DefindexModule {}
