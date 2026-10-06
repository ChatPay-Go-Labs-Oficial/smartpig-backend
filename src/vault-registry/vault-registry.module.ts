import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DisclosureService } from './disclosure.service';
import { DisclosureGuardService } from './disclosure.guard.service';
import { VaultRegistryService } from './vault-registry.service';
import { VaultRegistryAdminService } from './vault-registry.admin.service';
import { VaultRegistryAdminController } from './vault-registry.admin.controller';
import { VaultDisclosureController } from './vault-disclosure.controller';

/**
 * The single vault registry behind every vault read, plus the versioned risk
 * disclosures and the gate that blocks a first deposit without consent.
 *
 * Exports the services rather than wiring Prisma directly into consumers, so
 * `DepositsService`, `WithdrawalsService` and `VaultsService` all answer "which
 * vaults, and what are they" from the same place.
 */
@Module({
  imports: [AuthModule],
  providers: [
    VaultRegistryService,
    VaultRegistryAdminService,
    DisclosureService,
    DisclosureGuardService,
  ],
  controllers: [VaultRegistryAdminController, VaultDisclosureController],
  exports: [VaultRegistryService, DisclosureService, DisclosureGuardService],
})
export class VaultRegistryModule {}
