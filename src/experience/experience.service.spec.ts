import { ConflictException } from '@nestjs/common';
import { ExperienceService } from './experience.service';

function setup(options: { existingClaim?: boolean } = {}) {
  const tx = {
    experienceAccount: {
      findUnique: jest.fn().mockResolvedValue({ totalXp: 42 }),
    },
  };
  const prisma = {
    userExperienceRewardUnlock: { findMany: jest.fn().mockResolvedValue([]) },
    experienceXpLedgerEntry: {
      findUnique: jest
        .fn()
        .mockResolvedValue(options.existingClaim ? { id: 'claim-1' } : null),
    },
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const ledger = {
    profile: jest.fn().mockResolvedValue({ totalXp: 42, level: 1 }),
    grant: jest.fn().mockResolvedValue({
      granted: true,
      pointsGranted: 3,
      profile: { totalXp: 45, level: 1, tier: 'BEGINNER' },
    }),
  };
  const config = {
    get: jest.fn((_key: string, fallback: number) => fallback),
  };
  return {
    service: new ExperienceService(
      prisma as never,
      ledger as never,
      config as never,
    ),
    prisma,
    ledger,
  };
}

describe('ExperienceService', () => {
  it('returns all 50 rounded thresholds and daily reward availability', async () => {
    const { service } = setup();

    await expect(service.profile('user-a')).resolves.toMatchObject({
      totalXp: 42,
      dailyReward: { available: true, xp: 3 },
      levelThresholds: expect.arrayContaining([
        { level: 1, totalXp: 40 },
        { level: 2, totalXp: 139 },
        { level: 50, totalXp: 45731 },
      ]),
    });
  });

  it('grants the daily reward with a São Paulo calendar-date key', async () => {
    const { service, ledger } = setup();

    await expect(service.claimDailyReward('user-a')).resolves.toMatchObject({
      xpAwarded: 3,
      totalXp: 45,
      levelBefore: 1,
      levelAfter: 1,
    });
    expect(ledger.grant).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sourceRef: expect.stringMatching(/^daily-reward:\d{4}-\d{2}-\d{2}$/),
        points: 3,
        metadata: expect.objectContaining({ timeZone: 'America/Sao_Paulo' }),
      }),
    );
  });

  it('returns the stable 409 code when the day was already claimed', async () => {
    const { service, ledger } = setup();
    ledger.grant.mockResolvedValue({ granted: false, pointsGranted: 0 });

    const error = await service
      .claimDailyReward('user-a')
      .catch((value) => value);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'DAILY_REWARD_ALREADY_CLAIMED',
    });
  });
});
