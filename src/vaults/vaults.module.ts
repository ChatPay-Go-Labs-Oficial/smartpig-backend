import { Module } from '@nestjs/common';
import { VaultsService } from './vaults.service';
import { VaultsController } from './vaults.controller';
import { DefindexModule } from '../defindex/defindex.module';

@Module({
  imports: [DefindexModule],
  providers: [VaultsService],
  controllers: [VaultsController],
  exports: [VaultsService],
})
export class VaultsModule {}
