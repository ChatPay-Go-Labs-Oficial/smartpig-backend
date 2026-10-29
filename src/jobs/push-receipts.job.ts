import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { NotificationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { ExpoPushClient } from '../notifications/expo-push.client';
import { isPushEnabled } from './push-dispatch.job';

/** O Expo recomenda esperar ~15 min antes de pedir o receipt. */
const MIN_AGE_MS = 15 * 60_000;
/** Receipts somem em ~24 h; depois disso não adianta perguntar. */
const MAX_AGE_MS = 24 * 60 * 60_000;
/** Notificações por rodada. Cada uma tem até MAX_DEVICES_PER_USER tickets. */
const BATCH_SIZE = 500;

/** Erros de credencial do projeto: não são culpa do aparelho. */
const CREDENTIAL_ERRORS = new Set(['InvalidCredentials', 'MismatchSenderId']);

interface StoredTicket {
  ticketId: string;
  deviceId: string;
}

/**
 * Confere os receipts do Expo e desativa os aparelhos que o APNs/FCM disseram
 * não existir mais (DeviceNotRegistered). Sem isso, cada push seguiria indo
 * para tokens mortos, e o Expo pode limitar projetos que insistem neles.
 */
@Injectable()
export class PushReceiptsJob {
  private readonly logger = new Logger(PushReceiptsJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly expo: ExpoPushClient,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 */15 * * * *')
  async checkReceipts(): Promise<void> {
    if (this.running || !isPushEnabled(this.config)) return;
    this.running = true;
    try {
      await this.run();
    } catch (error) {
      this.logger.error(
        `Conferência de receipts falhou: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<void> {
    const now = Date.now();
    const rows = await this.prisma.notification.findMany({
      where: {
        status: NotificationStatus.SENT,
        receiptCheckedAt: null,
        sentAt: {
          lt: new Date(now - MIN_AGE_MS),
          gt: new Date(now - MAX_AGE_MS),
        },
      },
      orderBy: { sentAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, tickets: true },
    });
    if (rows.length === 0) return;

    const ticketOwner = new Map<
      string,
      { notificationId: string; deviceId: string }
    >();
    for (const row of rows) {
      for (const t of parseTickets(row.tickets)) {
        ticketOwner.set(t.ticketId, {
          notificationId: row.id,
          deviceId: t.deviceId,
        });
      }
    }

    const checked = new Set<string>();
    const failedLookup = new Set<string>();
    const notRegistered = new Set<string>();
    const errorsByNotification = new Map<string, string[]>();

    for (const ids of this.expo.chunkReceiptIds([...ticketOwner.keys()])) {
      let receipts: Awaited<ReturnType<ExpoPushClient['getReceipts']>>;
      try {
        receipts = await this.expo.getReceipts(ids);
      } catch (error) {
        // Sem marcar: a próxima rodada tenta de novo (até a janela de 24 h).
        for (const id of ids) {
          const owner = ticketOwner.get(id);
          if (owner) failedLookup.add(owner.notificationId);
        }
        this.logger.warn(
          `Consulta de receipts falhou: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      for (const id of ids) {
        const owner = ticketOwner.get(id)!;
        checked.add(owner.notificationId);
        const receipt = receipts[id];
        // Receipt ainda não disponível ou ok: nada a fazer.
        if (!receipt || receipt.status === 'ok') continue;

        const code = receipt.details?.error ?? 'erro';
        if (code === 'DeviceNotRegistered') {
          notRegistered.add(owner.deviceId);
        } else if (CREDENTIAL_ERRORS.has(code)) {
          this.logger.error(
            `Expo recusou credencial do projeto (${code}) no ticket ${id}: ${receipt.message}`,
          );
        } else {
          this.logger.warn(
            `Receipt ${id} com erro ${code}: ${receipt.message}`,
          );
        }
        const list = errorsByNotification.get(owner.notificationId) ?? [];
        list.push(`receipt ${code}: ${receipt.message}`);
        errorsByNotification.set(owner.notificationId, list);
      }
    }

    if (notRegistered.size > 0) {
      await this.prisma.pushDevice.updateMany({
        where: { id: { in: [...notRegistered] }, disabledAt: null },
        data: { disabledAt: new Date() },
      });
      this.logger.log(
        `${notRegistered.size} device(s) desativado(s) por DeviceNotRegistered`,
      );
    }

    for (const [notificationId, errors] of errorsByNotification) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { error: errors.join('; ').slice(0, 1000) },
      });
    }

    // Uma notificação com algum chunk que falhou fica para a próxima rodada
    // inteira; reconferir um receipt é inofensivo.
    const done = [...checked].filter((id) => !failedLookup.has(id));
    // Notificação SENT sem ticket nenhum (dado antigo/corrompido) também encerra.
    for (const row of rows) {
      if (parseTickets(row.tickets).length === 0) done.push(row.id);
    }
    if (done.length > 0) {
      await this.prisma.notification.updateMany({
        where: { id: { in: done } },
        data: { receiptCheckedAt: new Date() },
      });
    }
  }
}

function parseTickets(value: Prisma.JsonValue | null): StoredTicket[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (t): t is { ticketId: string; deviceId: string } =>
      typeof t === 'object' &&
      t !== null &&
      typeof (t as Record<string, unknown>).ticketId === 'string' &&
      typeof (t as Record<string, unknown>).deviceId === 'string',
  );
}
