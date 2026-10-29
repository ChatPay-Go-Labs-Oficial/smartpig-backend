import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import {
  NotificationCategory,
  NotificationStatus,
  type Notification,
} from '@prisma/client';
import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { PrismaService } from '../infra/prisma/prisma.service';
import { ExpoPushClient } from '../notifications/expo-push.client';
import { notificationUrl } from '../notifications/notification-copy';

/** Linhas PENDING por rodada. Com 10 s de intervalo, ~600/min no máximo. */
const BATCH_SIZE = 100;
/** Tentativas antes de um erro transitório (rede, 429, 5xx) virar FAILED. */
export const MAX_ATTEMPTS = 3;
/**
 * SENDING mais velho que isso é um envio que morreu no meio (deploy, crash).
 * Vira FAILED em vez de PENDING: não dá para saber se o Expo recebeu, e push
 * duplicado de dinheiro confunde mais do que push perdido.
 */
const STALE_SENDING_MS = 5 * 60_000;
/** Pausa depois de 429 / MessageRateExceeded. */
const RATE_LIMIT_BACKOFF_MS = 60_000;

type ClaimedRow = Pick<
  Notification,
  'id' | 'userId' | 'type' | 'category' | 'title' | 'body' | 'attempts'
>;

interface Target {
  notificationId: string;
  deviceId: string;
}

interface Outcome {
  tickets: { ticketId: string; deviceId: string }[];
  errors: string[];
  /** Algum erro foi transitório (vale tentar de novo). */
  retryable: boolean;
}

export function isPushEnabled(config: ConfigService): boolean {
  const value = config.get<boolean | string>('PUSH_DISPATCH_ENABLED');
  return value !== false && value !== 'false';
}

/**
 * Esvazia a outbox de push.
 *
 * Concorrência: cada linha passa de PENDING para SENDING por um update
 * condicional (`where status = PENDING`). Só quem viu `count === 1` envia,
 * então duas instâncias (ou duas rodadas sobrepostas) nunca mandam a mesma
 * notificação duas vezes.
 */
@Injectable()
export class PushDispatchJob {
  private readonly logger = new Logger(PushDispatchJob.name);
  private running = false;
  private pausedUntil = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly expo: ExpoPushClient,
    private readonly config: ConfigService,
  ) {}

  @Interval(10_000)
  async dispatch(): Promise<void> {
    if (this.running || !isPushEnabled(this.config)) return;
    if (Date.now() < this.pausedUntil) return;
    this.running = true;
    try {
      await this.failStaleSending();
      const claimed = await this.claimBatch();
      if (claimed.length > 0) await this.send(claimed);
    } catch (error) {
      this.logger.error(
        `Dispatch de push falhou: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async failStaleSending(): Promise<void> {
    const now = new Date();
    const stale = await this.prisma.notification.updateMany({
      where: {
        status: NotificationStatus.SENDING,
        updatedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) },
      },
      data: {
        status: NotificationStatus.FAILED,
        error:
          'Envio interrompido no meio; não reenviado para evitar duplicata',
        updatedAt: now,
      },
    });
    if (stale.count > 0) {
      this.logger.warn(`${stale.count} push(es) presos em SENDING → FAILED`);
    }
  }

  private async claimBatch(): Promise<ClaimedRow[]> {
    const candidates = await this.prisma.notification.findMany({
      where: { status: NotificationStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
      select: {
        id: true,
        userId: true,
        type: true,
        category: true,
        title: true,
        body: true,
        attempts: true,
      },
    });

    const claimed: ClaimedRow[] = [];
    for (const row of candidates) {
      const result = await this.prisma.notification.updateMany({
        where: { id: row.id, status: NotificationStatus.PENDING },
        data: {
          status: NotificationStatus.SENDING,
          attempts: { increment: 1 },
          // updateMany não dispara @updatedAt; o recovery de SENDING depende dele.
          updatedAt: new Date(),
        },
      });
      if (result.count === 1) {
        claimed.push({ ...row, attempts: row.attempts + 1 });
      }
    }
    return claimed;
  }

  private async send(rows: ClaimedRow[]): Promise<void> {
    const devices = await this.prisma.pushDevice.findMany({
      where: {
        userId: { in: [...new Set(rows.map((r) => r.userId))] },
        disabledAt: null,
      },
      select: { id: true, userId: true, token: true },
    });

    const messages: ExpoPushMessage[] = [];
    const targets: Target[] = [];
    const outcomes = new Map<string, Outcome>();

    for (const row of rows) {
      const own = devices.filter((d) => d.userId === row.userId);
      if (own.length === 0) {
        await this.finish(row.id, {
          status: NotificationStatus.SKIPPED,
          error: 'Nenhum device ativo',
        });
        continue;
      }
      outcomes.set(row.id, { tickets: [], errors: [], retryable: false });
      for (const device of own) {
        messages.push(buildMessage(row, device.token));
        targets.push({ notificationId: row.id, deviceId: device.id });
      }
    }
    if (messages.length === 0) return;

    const notRegistered: string[] = [];
    let offset = 0;
    // O SDK fatia na ordem original, então o índice global de cada mensagem
    // casa com `targets`.
    for (const chunk of this.expo.chunkMessages(messages)) {
      const chunkTargets = targets.slice(offset, offset + chunk.length);
      offset += chunk.length;

      let tickets: ExpoPushTicket[];
      try {
        tickets = await this.expo.send(chunk);
      } catch (error) {
        const retryable = isRetryableHttpError(error);
        if (statusOf(error) === 429) this.backoff();
        const message = `Expo ${statusOf(error) ?? 'rede'}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        for (const t of chunkTargets) {
          const o = outcomes.get(t.notificationId)!;
          o.errors.push(message);
          o.retryable ||= retryable;
        }
        continue;
      }

      tickets.forEach((ticket, i) => {
        const target = chunkTargets[i];
        if (!target) return;
        const o = outcomes.get(target.notificationId)!;
        if (ticket.status === 'ok') {
          o.tickets.push({ ticketId: ticket.id, deviceId: target.deviceId });
          return;
        }
        const code = ticket.details?.error ?? 'erro';
        o.errors.push(`${code}: ${ticket.message}`);
        if (code === 'DeviceNotRegistered') notRegistered.push(target.deviceId);
        if (code === 'MessageRateExceeded') {
          o.retryable = true;
          this.backoff();
        }
      });
    }

    if (notRegistered.length > 0) {
      await this.prisma.pushDevice.updateMany({
        where: { id: { in: notRegistered }, disabledAt: null },
        data: { disabledAt: new Date() },
      });
      this.logger.log(
        `${notRegistered.length} device(s) desativado(s) (DeviceNotRegistered)`,
      );
    }

    for (const row of rows) {
      const o = outcomes.get(row.id);
      if (!o) continue;
      const error =
        o.errors.length > 0 ? o.errors.join('; ').slice(0, 1000) : null;

      if (o.tickets.length > 0) {
        // Chegou a pelo menos um aparelho: não reenviar para não duplicar nos
        // outros. Os erros parciais ficam registrados.
        await this.finish(row.id, {
          status: NotificationStatus.SENT,
          ticketId: o.tickets[0].ticketId,
          tickets: o.tickets,
          sentAt: new Date(),
          error,
        });
      } else if (o.retryable && row.attempts < MAX_ATTEMPTS) {
        await this.finish(row.id, {
          status: NotificationStatus.PENDING,
          error,
        });
      } else {
        await this.finish(row.id, { status: NotificationStatus.FAILED, error });
      }
    }
  }

  private async finish(
    id: string,
    data: {
      status: NotificationStatus;
      error?: string | null;
      ticketId?: string;
      tickets?: { ticketId: string; deviceId: string }[];
      sentAt?: Date;
    },
  ): Promise<void> {
    await this.prisma.notification.update({ where: { id }, data });
  }

  private backoff(): void {
    this.pausedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
  }
}

function buildMessage(row: ClaimedRow, token: string): ExpoPushMessage {
  return {
    to: token,
    title: row.title,
    body: row.body,
    sound: 'default',
    channelId: row.category,
    priority:
      row.category === NotificationCategory.transactions ? 'high' : 'default',
    data: {
      type: row.type,
      url: notificationUrl(row.category),
      notificationId: row.id,
    },
  };
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' ? status : undefined;
}

/** Repete só erro de rede, 429 e 5xx. 4xx (payload, credencial) é definitivo. */
function isRetryableHttpError(error: unknown): boolean {
  const status = statusOf(error);
  return status === undefined || status === 429 || status >= 500;
}
