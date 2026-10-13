import { Decimal } from '@prisma/client/runtime/library';
import { PortfolioSnapshotJob } from './portfolio-snapshot.job';

function vault(id: string, assetSymbol: string) {
  return {
    id,
    defindexVaultId: `C${id.toUpperCase()}`,
    assetSymbol,
    assetDecimals: 7,
    protocol: 'DEFINDEX',
  };
}

function price(value: string, source = 'REFLECTOR', stale = false) {
  return {
    symbol: '',
    priceUsd: new Decimal(value),
    source,
    stale,
    asOf: new Date('2026-10-09T00:00:00.000Z'),
  };
}

interface Options {
  wallets?: { userId: string; stellarAddress: string }[];
  vaults?: ReturnType<typeof vault>[];
  positions?: Record<string, { underlying: string[]; shares: string } | Error>;
  prices?: Map<string, ReturnType<typeof price>>;
  touched?: string[];
}

function createJob(options: Options = {}) {
  const {
    wallets = [{ userId: 'user-a', stellarAddress: `G${'A'.repeat(55)}` }],
    vaults = [vault('v-eurc', 'EURC')],
    positions = { 'v-eurc': { underlying: ['2.5'], shares: '2.4' } },
    prices = new Map([['EURC', price('1.12')]]),
    touched = ['v-eurc'],
  } = options;

  const created: Record<string, unknown>[] = [];
  const priceRows: Record<string, unknown>[] = [];

  const prisma = {
    walletAccount: { findMany: jest.fn().mockResolvedValue(wallets) },
    vaultCatalog: { findMany: jest.fn().mockResolvedValue(vaults) },
    depositIntent: {
      findMany: jest
        .fn()
        .mockResolvedValue(touched.map((vaultId) => ({ vaultId }))),
    },
    withdrawalIntent: { findMany: jest.fn().mockResolvedValue([]) },
    portfolioSnapshot: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve(data);
      }),
    },
    assetPriceSnapshot: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        priceRows.push(data);
        return Promise.resolve(data);
      }),
    },
  };

  const getPosition = jest.fn((ref: { id: string }) => {
    const configured = positions[ref.id];
    if (configured instanceof Error) return Promise.reject(configured);
    return Promise.resolve(configured ?? { underlying: ['0'], shares: '0' });
  });

  const adapters = { get: jest.fn().mockReturnValue({ getPosition }) };
  const pricing = { getUsdPrices: jest.fn().mockResolvedValue(prices) };

  return {
    job: new PortfolioSnapshotJob(
      prisma as never,
      adapters as never,
      pricing as never,
    ),
    prisma,
    pricing,
    getPosition,
    created,
    priceRows,
  };
}

describe('PortfolioSnapshotJob', () => {
  describe('pricing', () => {
    it('prices once per run, before the wallet loop', async () => {
      // Per wallet per vault this would be thousands of oracle reads for the
      // same three numbers.
      const { job, pricing } = createJob({
        wallets: [
          { userId: 'user-a', stellarAddress: 'GA' },
          { userId: 'user-b', stellarAddress: 'GB' },
        ],
        touched: ['v-eurc'],
      });

      await job.takeSnapshots();

      expect(pricing.getUsdPrices).toHaveBeenCalledTimes(1);
    });

    it('records the prices used, so a past valuation can be audited', async () => {
      // An oracle only serves the latest price.
      const { job, priceRows } = createJob({
        prices: new Map([['EURC', { ...price('1.12'), symbol: 'EURC' }]]),
      });

      await job.takeSnapshots();

      expect(priceRows).toHaveLength(1);
      expect(priceRows[0]).toMatchObject({
        assetSymbol: 'EURC',
        source: 'REFLECTOR',
        stale: false,
      });
    });

    it('writes each price once, although the map is keyed twice', async () => {
      const shared = { ...price('0.195'), symbol: 'XLM' };
      const { job, priceRows } = createJob({
        vaults: [vault('v-xlm', 'XLM')],
        positions: { 'v-xlm': { underlying: ['10'], shares: '10' } },
        prices: new Map([
          ['XLM', shared],
          ['NATIVE', shared],
        ]),
        touched: ['v-xlm'],
      });

      await job.takeSnapshots();

      expect(priceRows).toHaveLength(1);
    });
  });

  describe('what each row records', () => {
    it('stores the underlying in whole units, with shares separate', async () => {
      // balanceAmount used to hold raw share units: a figure with no stated
      // scale, which was neither the asset amount nor a value.
      const { job, created } = createJob();

      await job.takeSnapshots();

      expect(created[0]).toMatchObject({ assetSymbol: 'EURC' });
      expect((created[0].balanceAmount as Decimal).toString()).toBe('2.5');
      expect((created[0].shareAmount as Decimal).toString()).toBe('2.4');
    });

    it('values the position and records the rate and its source', async () => {
      const { job, created } = createJob();

      await job.takeSnapshots();

      expect((created[0].balanceUsd as Decimal).toString()).toBe('2.8');
      expect((created[0].priceUsd as Decimal).toString()).toBe('1.12');
      expect(created[0].priceSource).toBe('REFLECTOR');
    });

    it('still takes the snapshot when nothing could price the asset', async () => {
      // Skipping it would lose the position itself, not just its value.
      const { job, created } = createJob({ prices: new Map() });

      await job.takeSnapshots();

      expect(created).toHaveLength(1);
      expect(created[0].balanceUsd).toBeNull();
      expect(created[0].priceSource).toBeNull();
      expect((created[0].balanceAmount as Decimal).toString()).toBe('2.5');
    });

    it('skips a position of zero', async () => {
      const { job, created } = createJob({
        positions: { 'v-eurc': { underlying: ['0'], shares: '0' } },
      });

      await job.takeSnapshots();

      expect(created).toHaveLength(0);
    });

    it('keeps going when one vault read fails', async () => {
      const { job, created } = createJob({
        vaults: [vault('v-down', 'EURC'), vault('v-ok', 'EURC')],
        positions: {
          'v-down': new Error('ETIMEDOUT'),
          'v-ok': { underlying: ['1'], shares: '1' },
        },
        touched: ['v-down', 'v-ok'],
      });

      await job.takeSnapshots();

      expect(created).toHaveLength(1);
    });
  });

  describe('scoping the vault loop', () => {
    it('reads only vaults the wallet has touched', async () => {
      // The full product grows with the catalog against a DeFindex rate limit
      // that already forced the sync jobs down to six hours.
      const { job, getPosition } = createJob({
        vaults: [vault('v-eurc', 'EURC'), vault('v-never', 'XLM')],
        positions: { 'v-eurc': { underlying: ['2'], shares: '2' } },
        prices: new Map([
          ['EURC', price('1.12')],
          ['XLM', price('0.195')],
        ]),
        touched: ['v-eurc'],
      });

      await job.takeSnapshots();

      expect(getPosition).toHaveBeenCalledTimes(1);
    });

    it('does nothing when there are no wallets or no vaults', async () => {
      const noWallets = createJob({ wallets: [] });
      await noWallets.job.takeSnapshots();
      expect(noWallets.pricing.getUsdPrices).not.toHaveBeenCalled();

      const noVaults = createJob({ vaults: [] });
      await noVaults.job.takeSnapshots();
      expect(noVaults.pricing.getUsdPrices).not.toHaveBeenCalled();
    });
  });
});
