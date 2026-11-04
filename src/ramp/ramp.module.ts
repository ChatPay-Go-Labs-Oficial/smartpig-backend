import { Module } from '@nestjs/common';
import { RampService } from './ramp.service';
import { RampKycService } from './kyc.service';
import { RampController } from './ramp.controller';
import { BlindPayModule } from '../blindpay/blindpay.module';
import { WalletsModule } from '../wallets/wallets.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, BlindPayModule, WalletsModule, NotificationsModule],
  providers: [RampService, RampKycService],
  controllers: [RampController],
})
export class RampModule {}
