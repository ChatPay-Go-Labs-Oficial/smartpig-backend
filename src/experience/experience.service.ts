import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { ExperienceLedgerService } from './experience-ledger.service';
import { dailyRewardWindow } from './daily-reward';
import {
  calculateExperienceLevel,
  MAX_USER_LEVEL,
  xpRequiredForLevel,
} from './experience-level';

@Injectable()
export class ExperienceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: ExperienceLedgerService,
    private readonly config: ConfigService = new ConfigService(),
  ) {}

  async claimDailyReward(userId: string) {
    const window = dailyRewardWindow();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`experience:${userId}`}))`,
      );
      const accountBefore = await tx.experienceAccount.findUnique({
        where: { userId },
        select: { totalXp: true },
      });
      const before = calculateExperienceLevel(accountBefore?.totalXp ?? 0);
      const grant = await this.ledger.grant(tx, {
        userId,
        sourceType: 'DAILY_ACTIVITY',
        sourceRef: `daily:${window.date}`,
        points: this.config.get<number>('EXPERIENCE_DAILY_REWARD_XP', 3),
        metadata: { timeZone: 'America/Sao_Paulo', rewardDate: window.date },
      });
      if (!grant.granted)
        throw new ConflictException({
          statusCode: 409,
          code: 'DAILY_REWARD_ALREADY_CLAIMED',
          message: 'Daily reward already claimed.',
          details: { nextAvailableAt: window.nextAvailableAt.toISOString() },
        });
      return {
        xpAwarded: grant.pointsGranted,
        ...grant.profile,
        levelBefore: before.level,
        levelAfter: grant.profile.level,
        tierAfter: grant.profile.tier,
        nextAvailableAt: window.nextAvailableAt.toISOString(),
        dailyReward: {
          available: false,
          nextAvailableAt: window.nextAvailableAt,
        },
      };
    });
  }

  async profile(userId: string) {
    const [level, unlocks] = await Promise.all([
      this.ledger.profile(userId),
      this.prisma.userExperienceRewardUnlock.findMany({
        where: { userId },
        orderBy: { unlockedAt: 'asc' },
        select: {
          unlockedAt: true,
          sourceLevel: true,
          reward: {
            select: {
              key: true,
              type: true,
              name: true,
              description: true,
              tier: true,
              payload: true,
            },
          },
        },
      }),
    ]);

    const window = dailyRewardWindow();
    const claimed = await this.prisma.experienceXpLedgerEntry.findUnique({
      where: { dedupeKey: `${userId}:DAILY_ACTIVITY:daily:${window.date}` },
      select: { id: true },
    });
    return {
      ...level,
      rewards: unlocks,
      levelThresholds: Array.from({ length: MAX_USER_LEVEL }, (_, i) => ({
        level: i + 1,
        totalXp: xpRequiredForLevel(i + 1),
      })),
      dailyReward: {
        available: !claimed,
        xp: this.config.get<number>('EXPERIENCE_DAILY_REWARD_XP', 3),
        nextAvailableAt: window.nextAvailableAt,
      },
    };
  }
}
