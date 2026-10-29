import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../auth/privy/admin-only.decorator';
import { BroadcastService, type BroadcastResult } from './broadcast.service';
import { BroadcastDto } from './dto/broadcast.dto';

/**
 * Broadcast de push para operadores.
 *
 * `@AdminOnly()` e não `@Admin()`: o segundo deixa qualquer usuário logado
 * passar quando o x-admin-key não vem, e um push para toda a base não é
 * decisão de usuário.
 */
@ApiTags('Notifications (admin)')
@AdminOnly()
@Controller('admin/notifications')
export class NotificationsAdminController {
  constructor(private readonly broadcasts: BroadcastService) {}

  @Post('broadcast')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Envia um push para todos os usuários elegíveis',
    description:
      'Cria uma notificação por usuário com device ativo no alvo (plataforma e ' +
      'versão), respeitando as preferências: APP_UPDATE_AVAILABLE é `updates`, ' +
      'ANNOUNCEMENT é `marketing` (desligado por padrão). O envio é assíncrono, ' +
      'pelo job de dispatch. Use `dryRun` para só contar. É a forma de avisar ' +
      'sobre uma versão nova: atualizar o app-config não dispara push.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        broadcastId: '3f1c…',
        dryRun: false,
        eligible: 1200,
        skippedByPreference: 40,
        toNotify: 1160,
        created: 1160,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Body inválido.' })
  broadcast(@Body() dto: BroadcastDto): Promise<BroadcastResult> {
    return this.broadcasts.broadcast(dto);
  }
}
