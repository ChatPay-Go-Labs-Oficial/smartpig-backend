import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    WalletsModule,
    DefindexModule,
    VaultsModule,
    DepositsModule,
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
  providers: [AppService],
})
export class AppModule {}
