import { Module } from '@nestjs/common';
import { BlindPayService } from './blindpay.service';

@Module({
  providers: [BlindPayService],
  exports: [BlindPayService],
})
export class BlindPayModule {}
