import { Module } from '@nestjs/common';
import { DefindexConfig } from './defindex.config';
import { DefindexService } from './defindex.service';
import { DefindexMapper } from './defindex.mapper';
import { DefindexOrchestrator } from './defindex.orchestrator';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [WalletsModule],
  providers: [
    DefindexConfig,
    DefindexService,
    DefindexMapper,
    DefindexOrchestrator,
  ],
  exports: [DefindexService, DefindexOrchestrator],
})
export class DefindexModule {}
