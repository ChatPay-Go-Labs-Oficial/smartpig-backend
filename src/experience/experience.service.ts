import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { ExperienceLedgerService } from './experience-ledger.service';
import { dailyRewardWindow } from './daily-reward';
import { xpRequiredForLevel } from './experience-level';

@Injectable()
export class ExperienceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: ExperienceLedgerService,
  ) {}

  async claimDailyReward(userId: string) {
    const window = dailyRewardWindow();
    return this.prisma.$transaction(async (tx) => {
      const grant = await this.ledger.grant(tx, {
        userId,
        sourceType: 'DAILY_ACTIVITY',
        sourceRef: `daily:${window.date}`,
        points: 3,
      });
      if (!grant.granted)
        throw new ConflictException({
          statusCode: 409,
          code: 'DAILY_REWARD_ALREADY_CLAIMED',
        });
      return {
        xpAwarded: grant.pointsGranted,
        ...grant.profile,
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
      levelThresholds: Array.from({ length: 50 }, (_, i) => ({
        level: i + 1,
        totalXp: xpRequiredForLevel(i + 1),
      })),
      dailyReward: {
        available: !claimed,
        nextAvailableAt: window.nextAvailableAt,
      },
    };
  }
}
