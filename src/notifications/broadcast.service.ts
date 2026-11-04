import { Injectable, Logger } from '@nestjs/common';
import { NotificationStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../infra/prisma/prisma.service';
import { NOTIFICATION_CATEGORY } from './notification-copy';
import { DEFAULT_PREFERENCES } from './notifications.service';
import {
  deviceMatchesTarget,
  platformEnum,
  type PushTarget,
} from './push-target';

export const BROADCAST_TYPES = [
  'APP_UPDATE_AVAILABLE',
  'ANNOUNCEMENT',
] as const;
export type BroadcastType = (typeof BROADCAST_TYPES)[number];

export interface BroadcastInput {
  type: BroadcastType;
  title: string;
  body: string;
  url?: string;
  platform?: 'ios' | 'android';
  maxAppVersion?: string;
  dryRun?: boolean;
}

export interface BroadcastResult {
  broadcastId: string;
  dryRun: boolean;
  /** Usuários com pelo menos um device ativo no alvo. */
  eligible: number;
  /** Elegíveis com a categoria desligada (marketing é opt-in). */
  skippedByPreference: number;
  /** eligible − skippedByPreference. */
  toNotify: number;
  /** Linhas realmente gravadas (0 no dryRun). */
  created: number;
}

const DEVICE_PAGE = 1000;
const WRITE_BATCH = 500;

/**
 * Broadcast de admin (novas versões, novidades).
 *
 * Grava uma Notification PENDING por usuário na outbox, e o PushDispatchJob faz
 * o resto. O alvo (plataforma/versão) vai junto em `data.target`, para o
 * dispatch mandar só aos aparelhos do alvo e não a todos os do usuário.
 * Usuários com a categoria desligada não geram linha nenhuma: um broadcast de
 * marketing não deve encher a outbox de SKIPPED.
 */
@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(private readonly prisma: PrismaService) {}

  async broadcast(input: BroadcastInput): Promise<BroadcastResult> {
    const broadcastId = randomUUID();
    const category = NOTIFICATION_CATEGORY[input.type];
    const target: PushTarget = {
      ...(input.platform ? { platform: input.platform } : {}),
      ...(input.maxAppVersion ? { maxAppVersion: input.maxAppVersion } : {}),
    };

    const userIds = await this.eligibleUsers(target);
    let skippedByPreference = 0;
    let created = 0;

    for (let i = 0; i < userIds.length; i += WRITE_BATCH) {
      const batch = userIds.slice(i, i + WRITE_BATCH);
      const prefs = await this.prisma.notificationPreference.findMany({
        where: { userId: { in: batch } },
      });
      const prefByUser = new Map(prefs.map((p) => [p.userId, p]));
      const accepted = batch.filter(
        (userId) =>
          (prefByUser.get(userId) ?? DEFAULT_PREFERENCES)[category] === true,
      );
      skippedByPreference += batch.length - accepted.length;

      if (input.dryRun || accepted.length === 0) continue;

      const data: Prisma.InputJsonObject = {
        broadcastId,
        ...(input.url ? { url: input.url } : {}),
        target: target as Prisma.InputJsonObject,
      };
      const result = await this.prisma.notification.createMany({
        data: accepted.map((userId) => ({
          userId,
          type: input.type,
          category,
          title: input.title,
          body: input.body,
          data,
          dedupeKey: `broadcast:${broadcastId}:${userId}`,
          status: NotificationStatus.PENDING,
        })),
        skipDuplicates: true,
      });
      created += result.count;
    }

    const summary: BroadcastResult = {
      broadcastId,
      dryRun: Boolean(input.dryRun),
      eligible: userIds.length,
      skippedByPreference,
      toNotify: userIds.length - skippedByPreference,
      created,
    };
    this.logger.log(
      `Broadcast ${broadcastId} (${input.type}${input.dryRun ? ', dryRun' : ''}): ${JSON.stringify(summary)}`,
    );
    return summary;
  }

  /** Usuários não excluídos com algum device ativo dentro do alvo. */
  private async eligibleUsers(target: PushTarget): Promise<string[]> {
    const users = new Set<string>();
    let cursor: string | undefined;

    for (;;) {
      const page = await this.prisma.pushDevice.findMany({
        where: {
          disabledAt: null,
          ...(target.platform
            ? { platform: platformEnum(target.platform) }
            : {}),
          user: { deletedAt: null },
        },
        orderBy: { id: 'asc' },
        take: DEVICE_PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, userId: true, platform: true, appVersion: true },
      });
      for (const device of page) {
        if (deviceMatchesTarget(device, target)) users.add(device.userId);
      }
      if (page.length < DEVICE_PAGE) break;
      cursor = page[page.length - 1].id;
    }
    return [...users];
  }
}
