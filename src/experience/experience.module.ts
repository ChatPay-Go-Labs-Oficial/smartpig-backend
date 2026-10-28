import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ExperienceController } from './experience.controller';
import { ExperienceLedgerService } from './experience-ledger.service';
import { ExperienceService } from './experience.service';

@Module({
  imports: [AuthModule],
  controllers: [ExperienceController],
  providers: [ExperienceLedgerService, ExperienceService],
  exports: [ExperienceLedgerService, ExperienceService],
})
export class ExperienceModule {}
