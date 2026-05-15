import { Module } from '@nestjs/common';
import { EtherfuseModule } from '../etherfuse/etherfuse.module';
import { EtherfuseRampService } from './etherfuse-ramp.service';
import { EtherfuseRampController } from './etherfuse-ramp.controller';

@Module({
  imports: [EtherfuseModule],
  providers: [EtherfuseRampService],
  controllers: [EtherfuseRampController],
})
export class EtherfuseRampModule {}
