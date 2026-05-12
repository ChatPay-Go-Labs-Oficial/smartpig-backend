import { Module } from '@nestjs/common';
import { RampService } from './ramp.service';
import { RampController } from './ramp.controller';
import { BlindPayModule } from '../blindpay/blindpay.module';

@Module({
  imports: [BlindPayModule],
  providers: [RampService],
  controllers: [RampController],
})
export class RampModule {}
