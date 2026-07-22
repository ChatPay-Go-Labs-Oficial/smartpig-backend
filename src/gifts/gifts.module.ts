import { Module } from '@nestjs/common';
import { GiftsService } from './gifts.service';
import { GiftStellarService } from './gift-stellar.service';
import { GiftsController } from './gifts.controller';

@Module({
  providers: [GiftsService, GiftStellarService],
  controllers: [GiftsController],
  exports: [GiftsService, GiftStellarService],
})
export class GiftsModule {}
