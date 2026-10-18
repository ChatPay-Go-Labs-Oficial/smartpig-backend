import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletsModule } from '../wallets/wallets.module';
import { ConversionsService } from './conversions.service';
import { ConversionsController } from './conversions.controller';
import { QuoteService } from './quote.service';

/**
 * Converting the funding asset into a vault's asset on the Stellar DEX.
 *
 * Only a `DEX` mode exists. An OTC path, where the Treasury would be the
 * counterparty, was considered and dropped: measured against Horizon, the order
 * book beat the alternative venue on price at every size, and being the
 * counterparty would mean holding inventory and carrying the price risk for a
 * route we would not use.
 */
@Module({
  imports: [AuthModule, WalletsModule],
  providers: [ConversionsService, QuoteService],
  controllers: [ConversionsController],
  exports: [ConversionsService],
})
export class ConversionsModule {}
