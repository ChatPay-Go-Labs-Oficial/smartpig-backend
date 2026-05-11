import { Module } from '@nestjs/common';
import { DefindexModule } from '../defindex/defindex.module';
import { VaultManagerController } from './vault-manager.controller';
import { VaultManagerService } from './vault-manager.service';

@Module({
  imports: [DefindexModule],
  controllers: [VaultManagerController],
  providers: [VaultManagerService],
})
export class VaultManagerModule {}
