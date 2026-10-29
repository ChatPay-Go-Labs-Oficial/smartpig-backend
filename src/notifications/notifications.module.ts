import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ExpoPushClient } from './expo-push.client';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushDevicesService } from './push-devices.service';

/**
 * Push notifications. Só depende de AuthModule (que não importa ninguém) e do
 * PrismaModule global, então qualquer módulo de negócio pode importá-lo sem
 * criar ciclo.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushDevicesService, ExpoPushClient],
  exports: [NotificationsService, ExpoPushClient],
})
export class NotificationsModule {}
