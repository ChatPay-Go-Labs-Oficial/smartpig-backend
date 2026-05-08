import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DefindexModule } from '../defindex/defindex.module';
import { ReconciliationJob } from './reconciliation.job';
import { ApySyncJob } from './apy-sync.job';
import { PortfolioSnapshotJob } from './portfolio-snapshot.job';
import { ExpiredIntentsJob } from './expired-intents.job';

@Module({
  imports: [ScheduleModule.forRoot(), DefindexModule],
  providers: [ReconciliationJob, ApySyncJob, PortfolioSnapshotJob, ExpiredIntentsJob],
})
export class JobsModule {}
