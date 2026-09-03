import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DefindexModule } from '../defindex/defindex.module';
import { WalletsModule } from '../wallets/wallets.module';
import { AccountDeletionController } from './account-deletion.controller';
import { EligibilityService } from './eligibility.service';

/**
 * Account deletion.
 *
 * Only the eligibility gate lives here so far. The saga, the scrub and the on-chain
 * closure land in later phases; `BlindPayModule` becomes a dependency then, not now —
 * KYC state deliberately does not block a deletion.
 */
@Module({
  imports: [AuthModule, DefindexModule, WalletsModule],
  controllers: [AccountDeletionController],
  providers: [EligibilityService],
  exports: [EligibilityService],
})
export class AccountDeletionModule {}
