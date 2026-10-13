import { VaultSyncJob } from './vault-sync.job';

const ADDRESS = 'CCB2AR5X3KP4WQKE7HNSUSDS7SHFMC2WPVSZ2ZXJ6DHXOKHFFKOZE6GK';

interface Options {
  /** Existing VaultCatalog row, or null to exercise the create path. */
  existing?: { id: string; isCurated: boolean } | null;
  /** What getVaultInfo reports, or null to simulate the enrichment call failing. */
  info?: { name?: string; assetSymbol?: string; tvl?: string } | null;
  apy?: number | null;
}

function createJob(options: Options = {}) {
  const {
    existing = { id: 'vault-1', isCurated: false },
    info = { name: 'DeFindex-Vault-Peridot XLM Vault', assetSymbol: 'native' },
    apy = 1.94,
  } = options;

  const creates: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  const prisma = {
    vaultCatalog: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        creates.push(data);
        return Promise.resolve(data);
      }),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return Promise.resolve(data);
      }),
    },
  };

  const defindex = {
    discoverVaults: jest.fn().mockResolvedValue({
      totalVaults: 1,
      vaults: [{ address: ADDRESS, apy }],
    }),
    getVaultInfo: info
      ? jest.fn().mockResolvedValue(info)
      : jest.fn().mockRejectedValue(new Error('rate limited')),
  };

  const job = new VaultSyncJob(
    prisma as unknown as never,
    defindex as unknown as never,
  );

  return { job, prisma, defindex, creates, updates };
}

describe('VaultSyncJob', () => {
  beforeAll(() => jest.useFakeTimers({ doNotFake: ['nextTick'] }));
  afterAll(() => jest.useRealTimers());

  async function run(job: VaultSyncJob) {
    const promise = job.syncVaultsFromDefindex();
    await jest.runAllTimersAsync();
    return promise;
  }

  describe("runtime activation is the admin's, not the job's", () => {
    it('never writes isActive when updating an existing vault', async () => {
      const { job, updates } = createJob();

      await run(job);

      expect(updates).toHaveLength(1);
      // The regression this guards: the job used to upsert isActive: true, so any
      // vault an admin switched off came back within six hours.
      expect(updates[0]).not.toHaveProperty('isActive');
    });

    it('leaves a deactivated vault deactivated', async () => {
      const { job, updates } = createJob({
        existing: { id: 'vault-off', isCurated: true },
      });

      await run(job);

      expect(updates[0]).not.toHaveProperty('isActive');
    });

    it('creates a newly discovered vault invisible, so listing it is a decision', async () => {
      const { job, creates } = createJob({ existing: null });

      await run(job);

      expect(creates).toHaveLength(1);
      expect(creates[0]).toMatchObject({ isActive: false, isCurated: false });
    });
  });

  describe('curated metadata survives a sync', () => {
    it('does not overwrite name or assetSymbol of a curated vault', async () => {
      const { job, updates } = createJob({
        existing: { id: 'vault-1', isCurated: true },
      });

      await run(job);

      // DeFindex reports XLM as "native"; a curated row says "XLM".
      expect(updates[0]).not.toHaveProperty('name');
      expect(updates[0]).not.toHaveProperty('assetSymbol');
      // What was observed is still recorded, just in the job's own columns.
      expect(updates[0]).toMatchObject({
        discoveredAssetSymbol: 'native',
        discoveredName: 'DeFindex-Vault-Peridot XLM Vault',
      });
    });

    it('does follow upstream for a vault nobody has curated', async () => {
      const { job, updates } = createJob({
        existing: { id: 'vault-1', isCurated: false },
      });

      await run(job);

      expect(updates[0]).toMatchObject({
        name: 'DeFindex-Vault-Peridot XLM Vault',
        assetSymbol: 'native',
      });
    });
  });

  describe('a failed enrichment call must not destroy data', () => {
    it('leaves name and assetSymbol untouched instead of writing UNKNOWN', async () => {
      const { job, updates } = createJob({ info: null });

      await run(job);

      // Previously this wrote the literal 'UNKNOWN' over a good value.
      expect(updates[0].name).toBeUndefined();
      expect(updates[0].assetSymbol).toBeUndefined();
      expect(updates[0].discoveredAssetSymbol).toBeUndefined();
      // The vault was still seen, which is the point of lastSeenAt.
      expect(updates[0].lastSeenAt).toBeInstanceOf(Date);
    });

    it('still records a vault whose metadata could not be read', async () => {
      const { job, creates } = createJob({ existing: null, info: null });

      await run(job);

      expect(creates[0]).toMatchObject({
        defindexVaultId: ADDRESS,
        name: ADDRESS,
        assetSymbol: 'UNKNOWN',
        isActive: false,
      });
    });
  });

  it('skips everything when discovery fails, rather than half-writing', async () => {
    const { job, prisma, defindex } = createJob();
    defindex.discoverVaults.mockRejectedValue(new Error('upstream 500'));

    await expect(run(job)).resolves.toBeUndefined();

    expect(prisma.vaultCatalog.update).not.toHaveBeenCalled();
    expect(prisma.vaultCatalog.create).not.toHaveBeenCalled();
  });
});
