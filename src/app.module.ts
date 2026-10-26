import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AccountDeletionModule } from './account-deletion/account-deletion.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { DefindexModule } from './defindex/defindex.module';
import { VaultsModule } from './vaults/vaults.module';
import { DepositsModule } from './deposits/deposits.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
import { GiftsModule } from './gifts/gifts.module';
import { JobsModule } from './jobs/jobs.module';
import { VaultManagerModule } from './vault-manager/vault-manager.module';
import { RampModule } from './ramp/ramp.module';
import { EtherfuseRampModule } from './etherfuse-ramp/etherfuse-ramp.module';
import { AppConfigModule } from './app-config/app-config.module';
import { VaultRegistryModule } from './vault-registry/vault-registry.module';
import { ConversionsModule } from './conversions/conversions.module';
import { PricingModule } from './pricing/pricing.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { LearningModule } from './learning/learning.module';

@Module({
  imports: [
    // Dois baldes: `short` corta rajada, `long` corta acesso sustentado em
    // volume. Rotas que precisam de limite proprio usam @Throttle no handler.
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1_000, limit: 10 },
      { name: 'long', ttl: 60_000, limit: 120 },
    ]),
    ConfigModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    WalletsModule,
    DefindexModule,
    VaultRegistryModule,
    VaultsModule,
    DepositsModule,
    ConversionsModule,
    PricingModule,
    PortfolioModule,
    LearningModule,
    WithdrawalsModule,
    GiftsModule,
    JobsModule,
    VaultManagerModule,
    RampModule,
    EtherfuseRampModule,
    AppConfigModule,
    AccountDeletionModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Roda antes do PrivyAuthGuard, registrado no AuthModule, para que o limite
    // seja aplicado antes de gastar uma verificacao de token na Privy.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
