import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccountOwnerService } from '../auth/privy/account-owner.service';
import { CurrentUser } from '../auth/privy/current-user.decorator';
import { PrivyAuthService } from '../auth/privy/privy-auth.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-preferences.dto';
import {
  NotificationsService,
  type NotificationPreferences,
} from './notifications.service';
import { PushDevicesService } from './push-devices.service';

const PREFERENCES_EXAMPLE = {
  transactions: true,
  updates: true,
  marketing: false,
  showDetails: false,
};

/**
 * Devices e preferências de push. A conta vem sempre do token (wallets que a
 * Privy verificou), nunca da requisição.
 */
@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly devices: PushDevicesService,
    private readonly notifications: NotificationsService,
    private readonly accountOwner: AccountOwnerService,
    private readonly privyAuthService: PrivyAuthService,
  ) {}

  @Post('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Registra (ou reativa) o token de push do aparelho',
  })
  @ApiResponse({ status: 204, description: 'Device registrado.' })
  @ApiResponse({ status: 400, description: 'Token ou plataforma inválidos.' })
  async registerDevice(
    @Body() dto: RegisterDeviceDto,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    const userId = await this.resolveOwner(user.id);
    await this.devices.register(userId, dto);
  }

  @Delete('devices/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove o token de push (logout). Idempotente.' })
  @ApiParam({
    name: 'token',
    description: 'Token Expo com encodeURIComponent',
  })
  @ApiResponse({ status: 204, description: 'Removido (ou já não existia).' })
  async removeDevice(
    @Param('token') token: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    const userId = await this.resolveOwner(user.id);
    await this.devices.remove(userId, token);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Preferências de push (padrões se nunca salvou)' })
  @ApiResponse({ status: 200, schema: { example: PREFERENCES_EXAMPLE } })
  async getPreferences(
    @CurrentUser() user: { id: string },
  ): Promise<NotificationPreferences> {
    const userId = await this.resolveOwner(user.id);
    return this.notifications.getPreferences(userId);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Atualiza parte das preferências de push' })
  @ApiResponse({ status: 200, schema: { example: PREFERENCES_EXAMPLE } })
  @ApiResponse({
    status: 400,
    description: 'Chave desconhecida ou não booleana.',
  })
  async updatePreferences(
    @Body() dto: UpdateNotificationPreferencesDto,
    @CurrentUser() user: { id: string },
  ): Promise<NotificationPreferences> {
    const userId = await this.resolveOwner(user.id);
    return this.notifications.updatePreferences(userId, dto);
  }

  private async resolveOwner(privyUserId: string): Promise<string> {
    const verifiedStellarAddresses =
      await this.privyAuthService.getStellarWalletAddresses(privyUserId);
    return this.accountOwner.assertOwnership(verifiedStellarAddresses);
  }
}
