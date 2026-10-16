import { LearningModule } from '../learning/learning.module';
import { Module } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalsController } from './withdrawals.controller';
import { DefindexModule } from '../defindex/defindex.module';

@Module({
  imports: [DefindexModule, LearningModule],
  providers: [WithdrawalsService],
  controllers: [WithdrawalsController],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
