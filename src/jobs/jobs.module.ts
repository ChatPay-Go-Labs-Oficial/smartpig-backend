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
import { AccountDeletionCleanupJob } from './account-deletion-cleanup.job';
import { ConversionRecoveryJob } from './conversion-recovery.job';
import { PricingModule } from '../pricing/pricing.module';
import { AccountDeletionModule } from '../account-deletion/account-deletion.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AccountDeletionModule,
    DefindexModule,
    GiftsModule,
    PricingModule,
  ],
  providers: [
    ReconciliationJob,
    ApySyncJob,
    PortfolioSnapshotJob,
    ExpiredIntentsJob,
    VaultSyncJob,
    GiftReconciliationJob,
    GiftExpiryJob,
    AccountDeletionCleanupJob,
    ConversionRecoveryJob,
  ],
})
export class JobsModule {}
