import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { DefindexModule } from './defindex/defindex.module';
import { VaultsModule } from './vaults/vaults.module';
import { DepositsModule } from './deposits/deposits.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
import { JobsModule } from './jobs/jobs.module';
import { VaultManagerModule } from './vault-manager/vault-manager.module';
import { RampModule } from './ramp/ramp.module';
import { EtherfuseRampModule } from './etherfuse-ramp/etherfuse-ramp.module';

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
    JobsModule,
    VaultManagerModule,
    RampModule,
    EtherfuseRampModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
