import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { ExperienceLedgerService } from './experience-ledger.service';

@Injectable()
export class ExperienceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: ExperienceLedgerService,
  ) {}

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

    return { ...level, rewards: unlocks };
  }
}
