import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { DefindexModule } from './defindex/defindex.module';
import { VaultsModule } from './vaults/vaults.module';
import { DepositsModule } from './deposits/deposits.module';

@Module({
  imports: [ConfigModule, PrismaModule, DefindexModule, VaultsModule, DepositsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
