import { Module, forwardRef } from '@nestjs/common';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { StellarService } from './stellar.service';
import { TrustlinesService } from './trustlines.service';
import { TrustlinesController } from './trustlines.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  // forwardRef because AuthModule imports WalletsModule for the activation flow;
  // the trustline controller needs AccountOwnerService from the other side.
  imports: [forwardRef(() => AuthModule)],
  controllers: [WalletsController, TrustlinesController],
  providers: [WalletsService, StellarService, TrustlinesService],
  exports: [WalletsService, StellarService, TrustlinesService],
})
export class WalletsModule {}
