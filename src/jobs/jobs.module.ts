import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DefindexModule } from '../defindex/defindex.module';
import { GiftsModule } from '../gifts/gifts.module';
import { ReconciliationJob } from './reconciliation.job';
import { ApySyncJob } from './apy-sync.job';
import { PortfolioSnapshotJob } from './portfolio-snapshot.job';
import { ExpiredIntentsJob } from './expired-intents.job';
import { VaultSyncJob } from './vault-sync.job';
import { GiftReconciliationJob } from './gift-reconciliation.job';
import { GiftExpiryJob } from './gift-expiry.job';

@Module({
  imports: [ScheduleModule.forRoot(), DefindexModule, GiftsModule],
  providers: [
    ReconciliationJob,
    ApySyncJob,
    PortfolioSnapshotJob,
    ExpiredIntentsJob,
    VaultSyncJob,
    GiftReconciliationJob,
    GiftExpiryJob,
  ],
})
export class JobsModule {}
