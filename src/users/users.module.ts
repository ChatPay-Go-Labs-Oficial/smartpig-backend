import { Module, forwardRef } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { UsersService } from './users.service';
import { VaultEligibilityModule } from '../vault-eligibility/vault-eligibility.module';

@Module({
  // forwardRef pelo mesmo motivo de WalletsModule: o controller precisa de
  // AccountOwnerService para resolver o dono a partir do token.
  imports: [forwardRef(() => AuthModule), VaultEligibilityModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
