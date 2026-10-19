import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GiftsService } from './gifts.service';
import { GiftStellarService } from './gift-stellar.service';
import { GiftsController } from './gifts.controller';

@Module({
  imports: [AuthModule],
  providers: [GiftsService, GiftStellarService],
  controllers: [GiftsController],
  exports: [GiftsService, GiftStellarService],
})
export class GiftsModule {}
