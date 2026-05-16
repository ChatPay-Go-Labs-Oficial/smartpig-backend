import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { StellarService } from './stellar.service';

@Module({
  controllers: [WalletsController],
  providers: [WalletsService, StellarService],
  exports: [WalletsService, StellarService],
})
export class WalletsModule {}
