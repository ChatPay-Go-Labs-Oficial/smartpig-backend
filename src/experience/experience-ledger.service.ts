import { Injectable } from '@nestjs/common';
import { Prisma, ExperienceXpSourceType } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import {
  calculateExperienceLevel,
  type ExperienceLevel,
} from './experience-level';

type DbClient = Prisma.TransactionClient | PrismaService;

export interface GrantXpInput {
  userId: string;
  sourceType: ExperienceXpSourceType;
  sourceRef: string;
  points: number;
  metadata?: Prisma.InputJsonValue;
}

export interface GrantXpResult {
  granted: boolean;
  pointsGranted: number;
  profile: ExperienceLevel;
}

@Injectable()
export class ExperienceLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async profile(userId: string): Promise<ExperienceLevel> {
    const account = await this.prisma.experienceAccount.findUnique({
      where: { userId },
      select: { totalXp: true },
    });
    return calculateExperienceLevel(account?.totalXp ?? 0);
  }

  async grant(db: DbClient, input: GrantXpInput): Promise<GrantXpResult> {
    if (!Number.isInteger(input.points) || input.points <= 0) {
      throw new RangeError('XP grant points must be a positive integer');
    }

    const dedupeKey = `${input.userId}:${input.sourceType}:${input.sourceRef}`;
    const inserted = await db.experienceXpLedgerEntry.createMany({
      data: [
        {
          userId: input.userId,
          sourceType: input.sourceType,
          sourceRef: input.sourceRef,
          dedupeKey,
          points: input.points,
          metadata: input.metadata,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 0) {
      return {
        granted: false,
        pointsGranted: 0,
        profile: await this.profileWith(db, input.userId),
      };
    }

    const account = await db.experienceAccount.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        totalXp: input.points,
        currentLevel: calculateExperienceLevel(input.points).level,
      },
      update: { totalXp: { increment: input.points } },
      select: { totalXp: true },
    });
    const totalXp = account.totalXp;
    const level = calculateExperienceLevel(totalXp);

    await db.experienceAccount.update({
      where: { userId: input.userId },
      data: { currentLevel: level.level },
    });

    await this.unlockEarnedRewards(db, input.userId, level.level);

    return { granted: true, pointsGranted: input.points, profile: level };
  }

  private async profileWith(
    db: DbClient,
    userId: string,
  ): Promise<ExperienceLevel> {
    const account = await db.experienceAccount.findUnique({
      where: { userId },
      select: { totalXp: true },
    });
    return calculateExperienceLevel(account?.totalXp ?? 0);
  }

  private async unlockEarnedRewards(
    db: DbClient,
    userId: string,
    level: number,
  ): Promise<void> {
    const rewards = await db.experienceRewardDefinition.findMany({
      where: { isActive: true, minimumLevel: { lte: level } },
      select: { id: true, minimumLevel: true },
    });

    for (const reward of rewards) {
      await db.userExperienceRewardUnlock.upsert({
        where: { userId_rewardId: { userId, rewardId: reward.id } },
        create: {
          userId,
          rewardId: reward.id,
          sourceLevel: reward.minimumLevel,
        },
        update: {},
      });
    }
  }
}
