import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthExampleController } from './privy/example.controller';
import { PrivyAuthGuard } from './privy/privy-auth.guard';
import { PrivyAuthService } from './privy/privy-auth.service';

@Module({
  controllers: [AuthController, AuthExampleController],
  providers: [
    AuthService,
    PrivyAuthService,
    {
      provide: APP_GUARD,
      useClass: PrivyAuthGuard,
    },
  ],
  exports: [AuthService, PrivyAuthService],
})
export class AuthModule {}
