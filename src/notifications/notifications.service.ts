import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationStatus,
  NotificationType,
  Prisma,
  type NotificationPreference,
} from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import {
  NOTIFICATION_CATEGORY,
  buildNotificationCopy,
  type NotificationDetails,
} from './notification-copy';

export interface NotificationPreferences {
  transactions: boolean;
  updates: boolean;
  marketing: boolean;
  showDetails: boolean;
}

/** Padrões do contrato: marketing é opt-in e o texto é genérico. */
export const DEFAULT_PREFERENCES: NotificationPreferences = Object.freeze({
  transactions: true,
  updates: true,
  marketing: false,
  showDetails: false,
});

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  /** Chave única do evento (ex.: `offramp:<id>:COMPLETED`). Repetir é no-op. */
  dedupeKey: string;
  /** Referência interna do evento (ids). Não vai no payload do push. */
  data?: Prisma.InputJsonObject;
  /** Dados para o texto detalhado; usados só se o usuário ligou showDetails. */
  details?: NotificationDetails;
}

/**
 * Produz notificações na outbox. Quem envia é o PushDispatchJob.
 *
 * `notify` é chamado de dentro de fluxos financeiros (webhooks, jobs de
 * reconciliação) e por isso nunca lança: um push perdido é aceitável, um
 * webhook que falha porque o push falhou não é.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async notify(input: NotifyInput): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { deletedAt: true, notificationPrefs: true },
      });
      // Conta excluída não recebe nada: o scrub já apagou os devices, e a
      // outbox não deve voltar a acumular dados dela.
      if (!user || user.deletedAt) return;

      const prefs = toPreferences(user.notificationPrefs);
      const category = NOTIFICATION_CATEGORY[input.type];
      const enabled = prefs[category];
      const copy = buildNotificationCopy(
        input.type,
        prefs.showDetails ? input.details : undefined,
      );

      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          category,
          title: copy.title,
          body: copy.body,
          data: input.data,
          dedupeKey: input.dedupeKey,
          status: enabled
            ? NotificationStatus.PENDING
            : NotificationStatus.SKIPPED,
          error: enabled ? null : `Categoria ${category} desligada`,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Mesmo evento visto de novo (webhook repetido, sync manual depois do
        // webhook): o dedupeKey já garantiu um único push.
        this.logger.debug(`notify ignorado: ${input.dedupeKey} já existe`);
        return;
      }
      this.logger.error(
        `notify falhou (${input.type}, ${input.dedupeKey}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const row = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    return toPreferences(row);
  }

  async updatePreferences(
    userId: string,
    patch: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences> {
    const data = pickPreferences(patch);
    const row = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return toPreferences(row);
  }
}

function toPreferences(
  row: NotificationPreference | null | undefined,
): NotificationPreferences {
  if (!row) return { ...DEFAULT_PREFERENCES };
  return {
    transactions: row.transactions,
    updates: row.updates,
    marketing: row.marketing,
    showDetails: row.showDetails,
  };
}

/** Só as quatro chaves conhecidas, e só as que vieram. */
function pickPreferences(
  patch: Partial<NotificationPreferences>,
): Partial<NotificationPreferences> {
  const out: Partial<NotificationPreferences> = {};
  for (const key of Object.keys(DEFAULT_PREFERENCES) as Array<
    keyof NotificationPreferences
  >) {
    if (typeof patch[key] === 'boolean') out[key] = patch[key];
  }
  return out;
}
