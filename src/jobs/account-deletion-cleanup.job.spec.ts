import { AccountDeletionCleanupJob } from './account-deletion-cleanup.job';

const REQUEST = 'req-1';
const USER = 'user-a';
const PRIVY = 'did:privy:user-a';

interface Options {
  pending?: Record<string, unknown>[];
  /** Status the request lands on after `cleanUpExternals` runs. */
  statusAfter?: string;
  cleanUpThrows?: boolean;
  maxAttempts?: number;
}

function createJob(options: Options = {}) {
  const {
    pending = [
      {
        id: REQUEST,
        userId: USER,
        privyUserId: PRIVY,
        cleanupAttempts: 0,
      },
    ],
    statusAfter = 'COMPLETED',
    cleanUpThrows = false,
    maxAttempts = 10,
  } = options;

  const updates: Record<string, unknown>[] = [];
  let findManyArgs: { where: Record<string, unknown> } | null = null;

  const prisma = {
    accountDeletionRequest: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        findManyArgs = args;
        return Promise.resolve(pending);
      }),
      findUnique: jest.fn().mockResolvedValue({ status: statusAfter }),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return Promise.resolve(data);
      }),
    },
  };

  const deletion = {
    cleanUpExternals: cleanUpThrows
      ? jest.fn().mockRejectedValue(new Error('privy down'))
      : jest.fn().mockResolvedValue(undefined),
  };

  const config = {
    get: jest.fn().mockReturnValue(maxAttempts),
  };

  return {
    prisma,
    deletion,
    updates,
    seenFilter: () => findManyArgs,
    job: new AccountDeletionCleanupJob(
      prisma as never,
      deletion as never,
      config as never,
    ),
  };
}

describe('AccountDeletionCleanupJob', () => {
  it('only picks up requests stuck at the external steps', async () => {
    const { job, seenFilter } = createJob();

    await job.retryPendingCleanups();

    expect(seenFilter()?.where.status).toBe('LOCAL_SCRUBBED');
    expect(seenFilter()?.where.cleanupAttempts).toEqual({ lt: 10 });
  });

  it('completes the deletion when the retry succeeds', async () => {
    const { job, deletion, updates } = createJob({ statusAfter: 'COMPLETED' });

    await job.retryPendingCleanups();

    expect(deletion.cleanUpExternals).toHaveBeenCalledWith(
      REQUEST,
      USER,
      PRIVY,
    );
    // Nothing else to write: cleanUpExternals already promoted the status.
    expect(updates).toEqual([]);
  });

  it('counts the attempt and keeps the state when the partner is still down', async () => {
    const { job, updates } = createJob({
      statusAfter: 'LOCAL_SCRUBBED',
      cleanUpThrows: true,
    });

    await job.retryPendingCleanups();

    expect(updates).toEqual([{ cleanupAttempts: 1 }]);
  });

  it('marks the request failed once the attempts run out', async () => {
    const { job, updates } = createJob({
      pending: [
        { id: REQUEST, userId: USER, privyUserId: PRIVY, cleanupAttempts: 9 },
      ],
      statusAfter: 'LOCAL_SCRUBBED',
      cleanUpThrows: true,
      maxAttempts: 10,
    });

    await job.retryPendingCleanups();

    expect(updates[0]).toMatchObject({ status: 'FAILED' });
  });

  it('fails loudly on a request with no identity provider id', async () => {
    // It cannot be finished here: after the scrub there is no way back from the
    // local account to the DID. Better in front of a human than cycling silently.
    const { job, deletion, updates } = createJob({
      pending: [
        { id: REQUEST, userId: USER, privyUserId: null, cleanupAttempts: 0 },
      ],
    });

    await job.retryPendingCleanups();

    expect(deletion.cleanUpExternals).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ status: 'FAILED' });
  });

  it('does nothing when there is nothing pending', async () => {
    const { job, deletion, updates } = createJob({ pending: [] });

    await job.retryPendingCleanups();

    expect(deletion.cleanUpExternals).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('never touches the on-chain closure or the scrub', async () => {
    // Both already happened atomically. The job's whole surface is the two
    // external calls, and it reaches them through the saga's own method.
    const { job, deletion } = createJob();

    await job.retryPendingCleanups();

    expect(Object.keys(deletion)).toEqual(['cleanUpExternals']);
  });
});
