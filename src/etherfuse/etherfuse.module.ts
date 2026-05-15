import { Module } from '@nestjs/common';
import { EtherfuseService } from './etherfuse.service';

@Module({
  providers: [EtherfuseService],
  exports: [EtherfuseService],
})
export class EtherfuseModule {}
