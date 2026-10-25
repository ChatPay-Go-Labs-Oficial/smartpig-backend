import { ExperienceService } from './experience.service';
import { dailyRewardWindow } from './daily-reward';

describe('Daily XP reward', () => {
  it('uses Sao Paulo midnight rather than UTC midnight', () => {
    expect(dailyRewardWindow(new Date('2026-10-25T02:59:59Z'))).toEqual({
      date: '2026-10-24',
      nextAvailableAt: new Date('2026-10-25T03:00:00Z'),
    });
    expect(dailyRewardWindow(new Date('2026-10-25T03:00:00Z')).date).toBe(
      '2026-10-25',
    );
  });
  it('awards 3 XP and returns 409 on a duplicate daily ledger entry', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      experienceAccount: {
        findUnique: jest.fn().mockResolvedValue({ totalXp: 0 }),
      },
    };
    const prisma = { $transaction: (fn: (db: unknown) => unknown) => fn(tx) };
    const ledger = {
      grant: jest
        .fn()
        .mockResolvedValueOnce({
          granted: true,
          pointsGranted: 3,
          profile: { totalXp: 3 },
        })
        .mockResolvedValueOnce({ granted: false }),
    };
    const service = new ExperienceService(prisma as never, ledger as never);
    await expect(service.claimDailyReward('u')).resolves.toMatchObject({
      xpAwarded: 3,
      dailyReward: { available: false },
    });
    await expect(service.claimDailyReward('u')).rejects.toMatchObject({
      response: { code: 'DAILY_REWARD_ALREADY_CLAIMED' },
    });
    expect(ledger.grant).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        points: 3,
        sourceType: 'DAILY_ACTIVITY',
        sourceRef: expect.stringMatching(/^daily:\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });
  it('exposes thresholds and daily availability in the profile', async () => {
    const service = new ExperienceService(
      {
        userExperienceRewardUnlock: { findMany: async () => [] },
        experienceXpLedgerEntry: { findUnique: async () => null },
      } as never,
      { profile: async () => ({ totalXp: 0, level: 0 }) } as never,
    );
    const profile = await service.profile('u');
    expect(profile.levelThresholds).toHaveLength(50);
    expect(profile.levelThresholds[0]).toEqual({ level: 1, totalXp: 40 });
    expect(profile.dailyReward.available).toBe(true);
  });
});
