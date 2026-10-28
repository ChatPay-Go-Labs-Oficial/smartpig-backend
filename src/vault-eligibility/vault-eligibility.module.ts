import { Module } from '@nestjs/common';
import { VaultEligibilityService } from './vault-eligibility.service';
import { VaultEligibilityAdminController } from './vault-eligibility.admin.controller';

@Module({
  controllers: [VaultEligibilityAdminController],
  providers: [VaultEligibilityService],
  exports: [VaultEligibilityService],
})
export class VaultEligibilityModule {}
