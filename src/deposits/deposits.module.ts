import { LearningModule } from '../learning/learning.module';
import { Module } from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { DepositsController } from './deposits.controller';
import { DefindexModule } from '../defindex/defindex.module';

@Module({
  imports: [DefindexModule, LearningModule],
  providers: [DepositsService],
  controllers: [DepositsController],
  exports: [DepositsService],
})
export class DepositsModule {}
