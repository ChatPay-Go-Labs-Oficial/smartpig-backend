import { ExperienceLedgerService } from './experience-ledger.service';

function setup(inserted: number) {
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    experienceXpLedgerEntry: {
      createMany: jest.fn().mockResolvedValue({ count: inserted }),
    },
    experienceAccount: {
      findUnique: jest.fn().mockResolvedValue({ totalXp: 15 }),
      upsert: jest.fn().mockResolvedValue({ totalXp: 45 }),
      update: jest.fn().mockResolvedValue({}),
    },
    experienceRewardDefinition: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'frame-1', minimumLevel: 1 }]),
    },
    userExperienceRewardUnlock: { upsert: jest.fn().mockResolvedValue({}) },
  };
  return { db, service: new ExperienceLedgerService({} as never) };
}
describe('XP ledger deduplication', () => {
  it('ignores the same origin when the unique insert loses the race', async () => {
    const { db, service } = setup(0);
    await expect(
      service.grant(db as never, {
        userId: 'u',
        sourceType: 'LEARNING_MODULE',
        sourceRef: 'lesson:M1',
        points: 15,
      }),
    ).resolves.toMatchObject({ granted: false, pointsGranted: 0 });
    expect(db.experienceAccount.upsert).not.toHaveBeenCalled();
  });
  it('updates projection and rewards using the same transaction after insertion', async () => {
    const { db, service } = setup(1);
    await expect(
      service.grant(db as never, {
        userId: 'u',
        sourceType: 'LEARNING_MODULE',
        sourceRef: 'module:INTRO',
        points: 45,
      }),
    ).resolves.toMatchObject({
      granted: true,
      pointsGranted: 45,
      profile: { level: 1 },
    });
    expect(db.experienceXpLedgerEntry.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [
          expect.objectContaining({
            dedupeKey: 'u:LEARNING_MODULE:module:INTRO',
          }),
        ],
      }),
    );
    expect(db.userExperienceRewardUnlock.upsert).toHaveBeenCalled();
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.experienceXpLedgerEntry.createMany.mock.invocationCallOrder[0],
    );
  });
});
