import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccountOwnerService } from './privy/account-owner.service';
import { AuthExampleController } from './privy/example.controller';
import { PrivyAuthGuard } from './privy/privy-auth.guard';
import { PrivyAuthService } from './privy/privy-auth.service';
import { IDENTITY_DELETER } from './privy/identity-deleter.port';

@Module({
  controllers: [AuthController, AuthExampleController],
  providers: [
    AuthService,
    PrivyAuthService,
    AccountOwnerService,
    {
      provide: APP_GUARD,
      useClass: PrivyAuthGuard,
    },
    { provide: IDENTITY_DELETER, useExisting: PrivyAuthService },
  ],
  exports: [
    AuthService,
    PrivyAuthService,
    AccountOwnerService,
    IDENTITY_DELETER,
  ],
})
export class AuthModule {}
