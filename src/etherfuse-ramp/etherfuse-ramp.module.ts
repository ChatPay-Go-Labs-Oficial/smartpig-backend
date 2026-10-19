import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EtherfuseModule } from '../etherfuse/etherfuse.module';
import { EtherfuseRampService } from './etherfuse-ramp.service';
import { EtherfuseRampController } from './etherfuse-ramp.controller';

@Module({
  imports: [AuthModule, EtherfuseModule],
  providers: [EtherfuseRampService],
  controllers: [EtherfuseRampController],
})
export class EtherfuseRampModule {}
