import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ExperienceModule } from '../experience/experience.module';
import { VaultEligibilityModule } from '../vault-eligibility/vault-eligibility.module';
import { LearningController } from './learning.controller';
import { LearningService } from './learning.service';

@Module({
  imports: [AuthModule, ExperienceModule, VaultEligibilityModule],
  controllers: [LearningController],
  providers: [LearningService],
  exports: [LearningService],
})
export class LearningModule {}
