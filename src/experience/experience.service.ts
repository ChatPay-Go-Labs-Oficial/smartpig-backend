import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExperienceXpSourceType } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { ExperienceLedgerService } from './experience-ledger.service';
import {
  calculateExperienceLevel,
  MAX_USER_LEVEL,
  xpRequiredForLevel,
} from './experience-level';

const EXPERIENCE_TIME_ZONE = 'America/Sao_Paulo';

@Injectable()
export class ExperienceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: ExperienceLedgerService,
    private readonly config: ConfigService,
  ) {}

  async profile(userId: string) {
    const rewardDate = saoPauloDateKey(new Date());
    const dedupeKey = `${userId}:${ExperienceXpSourceType.DAILY_ACTIVITY}:daily-reward:${rewardDate}`;
    const [level, unlocks, dailyClaim] = await Promise.all([
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
      this.prisma.experienceXpLedgerEntry.findUnique({
        where: { dedupeKey },
        select: { id: true },
      }),
    ]);

    return {
      ...level,
      rewards: unlocks,
      levelThresholds: Array.from({ length: MAX_USER_LEVEL }, (_, index) => ({
        level: index + 1,
        totalXp: xpRequiredForLevel(index + 1),
      })),
      dailyReward: {
        available: !dailyClaim,
        xp: this.config.get<number>('EXPERIENCE_DAILY_REWARD_XP', 3),
        nextAvailableAt: nextSaoPauloMidnight(new Date()).toISOString(),
      },
    };
  }

  async claimDailyReward(userId: string) {
    const now = new Date();
    const rewardDate = saoPauloDateKey(now);
    const points = this.config.get<number>('EXPERIENCE_DAILY_REWARD_XP', 3);

    return this.prisma.$transaction(async (tx) => {
      const accountBefore = await tx.experienceAccount.findUnique({
        where: { userId },
        select: { totalXp: true },
      });
      const before = calculateExperienceLevel(accountBefore?.totalXp ?? 0);
      const grant = await this.ledger.grant(tx, {
        userId,
        sourceType: ExperienceXpSourceType.DAILY_ACTIVITY,
        sourceRef: `daily-reward:${rewardDate}`,
        points,
        metadata: { timeZone: EXPERIENCE_TIME_ZONE, rewardDate },
      });
      if (!grant.granted) {
        throw new ConflictException({
          statusCode: 409,
          code: 'DAILY_REWARD_ALREADY_CLAIMED',
          message: 'Daily reward already claimed.',
          details: {
            nextAvailableAt: nextSaoPauloMidnight(now).toISOString(),
          },
        });
      }

      return {
        xpAwarded: grant.pointsGranted,
        totalXp: grant.profile.totalXp,
        levelBefore: before.level,
        levelAfter: grant.profile.level,
        tierAfter: grant.profile.tier,
        nextAvailableAt: nextSaoPauloMidnight(now).toISOString(),
      };
    });
  }
}

function saoPauloDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: EXPERIENCE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function nextSaoPauloMidnight(now: Date): Date {
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: EXPERIENCE_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const dateValue = (type: Intl.DateTimeFormatPartTypes) =>
    Number(dateParts.find((part) => part.type === type)?.value);
  const targetAsUtc = Date.UTC(
    dateValue('year'),
    dateValue('month') - 1,
    dateValue('day') + 1,
  );

  // Convert the next local midnight to an instant without hardcoding UTC-03.
  // Iterating also handles a future timezone/DST rule change in the IANA data.
  let instant = targetAsUtc;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: EXPERIENCE_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = formatter.formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    const representedAsUtc = Date.UTC(
      value('year'),
      value('month') - 1,
      value('day'),
      value('hour'),
      value('minute'),
      value('second'),
    );
    instant += targetAsUtc - representedAsUtc;
  }
  return new Date(instant);
}
