import { Module } from '@nestjs/common';
import { RampService } from './ramp.service';
import { RampKycService } from './kyc.service';
import { RampController } from './ramp.controller';
import { BlindPayModule } from '../blindpay/blindpay.module';

@Module({
  imports: [BlindPayModule],
  providers: [RampService, RampKycService],
  controllers: [RampController],
})
export class RampModule {}
