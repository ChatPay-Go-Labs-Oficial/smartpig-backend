import { Module, forwardRef } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { UsersService } from './users.service';
import { VaultEligibilityModule } from '../vault-eligibility/vault-eligibility.module';
import { WalletsModule } from '../wallets/wallets.module';
import { UsernamesController } from './usernames.controller';
import { UsernamesService } from './usernames.service';

@Module({
  // forwardRef pelo mesmo motivo de WalletsModule: o controller precisa de
  // AccountOwnerService para resolver o dono a partir do token.
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => WalletsModule),
    VaultEligibilityModule,
  ],
  controllers: [UsersController, UsernamesController],
  providers: [UsersService, UsernamesService],
  exports: [UsersService],
})
export class UsersModule {}
