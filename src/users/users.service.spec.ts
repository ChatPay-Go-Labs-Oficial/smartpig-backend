import { UsersService } from './users.service';

describe('UsersService experience mode', () => {
  function createService(experienceMode: 'LITE' | 'PRO' | null) {
    const row = {
      id: 'user-1',
      name: null,
      email: null,
      avatarUrl: null,
      isOnboarded: false,
      experienceMode,
      experienceModeUpdatedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest
          .fn()
          .mockImplementation(
            ({ data }: { data: { experienceMode: string } }) =>
              Promise.resolve({ ...row, experienceMode: data.experienceMode }),
          ),
      },
    };
    const eligibility = {
      refreshUnlocksForUser: jest.fn().mockResolvedValue([]),
    };
    return {
      prisma,
      eligibility,
      service: new UsersService(prisma as never, eligibility as never),
    };
  }

  it('projects a legacy null preference as effective PRO', async () => {
    const { service } = createService(null);

    await expect(service.getUser('user-1')).resolves.toMatchObject({
      experienceMode: 'PRO',
    });
  });

  it('sets the requested mode idempotently', async () => {
    const { service, prisma, eligibility } = createService('LITE');

    await expect(
      service.updateExperienceMode('user-1', { mode: 'LITE' }),
    ).resolves.toMatchObject({ experienceMode: 'LITE' });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          experienceMode: 'LITE',
          experienceModeUpdatedAt: expect.any(Date),
        },
      }),
    );
    expect(eligibility.refreshUnlocksForUser).toHaveBeenCalledWith('user-1');
  });

  it('does not run Lite eligibility materialization when selecting Pro', async () => {
    const { service, eligibility } = createService('LITE');

    await service.updateExperienceMode('user-1', { mode: 'PRO' });

    expect(eligibility.refreshUnlocksForUser).not.toHaveBeenCalled();
  });
});
