import { Module } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalsController } from './withdrawals.controller';
import { AuthModule } from '../auth/auth.module';
import { DefindexModule } from '../defindex/defindex.module';

@Module({
  imports: [AuthModule, DefindexModule],
  providers: [WithdrawalsService],
  controllers: [WithdrawalsController],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
