import { Decimal } from '@prisma/client/runtime/library';
import { NotFoundException } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';

const ADDRESS = `G${'A'.repeat(55)}`;

function vault(id: string, assetSymbol: string, name = id) {
  return {
    id,
    name,
    defindexVaultId: `C${id.toUpperCase()}`,
    assetSymbol,
    assetDecimals: 7,
    protocol: 'DEFINDEX',
  };
}

function price(value: string, source = 'REFLECTOR', stale = false) {
  return {
    priceUsd: new Decimal(value),
    source,
    stale,
    asOf: new Date(),
    symbol: '',
  };
}

interface Options {
  wallet?: { stellarAddress: string } | null;
  vaults?: ReturnType<typeof vault>[];
  positions?: Record<string, { underlying: string[]; shares: string } | Error>;
  prices?: Map<string, ReturnType<typeof price>>;
}

function createService(options: Options = {}) {
  const {
    wallet = { stellarAddress: ADDRESS },
    vaults = [],
    positions = {},
    prices = new Map(),
  } = options;

  const prisma = {
    walletAccount: { findFirst: jest.fn().mockResolvedValue(wallet) },
  };

  const registry = { listForUser: jest.fn().mockResolvedValue(vaults) };

  const adapters = {
    get: jest.fn().mockReturnValue({
      getPosition: jest.fn((ref: { id: string }) => {
        const configured = positions[ref.id];
        if (configured instanceof Error) return Promise.reject(configured);
        return Promise.resolve(
          configured ?? { underlying: ['0'], shares: '0' },
        );
      }),
    }),
  };

  const pricing = { getUsdPrices: jest.fn().mockResolvedValue(prices) };

  return {
    service: new PortfolioService(
      prisma as never,
      registry as never,
      adapters as never,
      pricing as never,
    ),
  };
}

describe('PortfolioService.summary', () => {
  it('sums positions across assets into one USD total', async () => {
    // 2 EURC at 1.12 plus 10 XLM at 0.195 = 2.24 + 1.95
    const { service } = createService({
      vaults: [vault('v-eurc', 'EURC'), vault('v-xlm', 'XLM')],
      positions: {
        'v-eurc': { underlying: ['2'], shares: '1.9' },
        'v-xlm': { underlying: ['10'], shares: '9.5' },
      },
      prices: new Map([
        ['EURC', price('1.12')],
        ['XLM', price('0.195')],
      ]),
    });

    const summary = await service.summary('user-a');

    expect(summary.totalUsd).toBe('4.19');
    expect(summary.positions).toHaveLength(2);
    expect(summary.priceSource).toBe('REFLECTOR');
  });

  it('reports each position in its own asset as well as in USD', async () => {
    const { service } = createService({
      vaults: [vault('v-eurc', 'EURC', 'Porquinho EURC')],
      positions: { 'v-eurc': { underlying: ['2.5'], shares: '2.4' } },
      prices: new Map([['EURC', price('1.12')]]),
    });

    const [position] = (await service.summary('user-a')).positions;

    expect(position).toMatchObject({
      vaultName: 'Porquinho EURC',
      assetSymbol: 'EURC',
      amountAsset: '2.5',
      amountUsd: '2.8',
      shares: '2.4',
    });
  });

  it('nulls the total when any held position could not be priced', async () => {
    // A partial total looks complete and understates what the user has. The app
    // falls back to the per-asset list.
    const { service } = createService({
      vaults: [vault('v-eurc', 'EURC'), vault('v-cetes', 'CETES')],
      positions: {
        'v-eurc': { underlying: ['2'], shares: '2' },
        'v-cetes': { underlying: ['100'], shares: '100' },
      },
      prices: new Map([['EURC', price('1.12')]]),
    });

    const summary = await service.summary('user-a');

    expect(summary.totalUsd).toBeNull();
    // The unpriced position is still listed, with a null value.
    const cetes = summary.positions.find((p) => p.assetSymbol === 'CETES');
    expect(cetes?.amountUsd).toBeNull();
    expect(cetes?.amountAsset).toBe('100');
  });

  it('nulls the total when a vault could not be read at all', async () => {
    // An unreadable vault is not a vault holding nothing; counting it as zero
    // would understate the total silently.
    const { service } = createService({
      vaults: [vault('v-eurc', 'EURC'), vault('v-down', 'XLM')],
      positions: {
        'v-eurc': { underlying: ['2'], shares: '2' },
        'v-down': new Error('ETIMEDOUT'),
      },
      prices: new Map([
        ['EURC', price('1.12')],
        ['XLM', price('0.195')],
      ]),
    });

    await expect(service.summary('user-a')).resolves.toMatchObject({
      totalUsd: null,
    });
  });

  it('omits a vault the user holds nothing in', async () => {
    const { service } = createService({
      vaults: [vault('v-eurc', 'EURC'), vault('v-empty', 'XLM')],
      positions: {
        'v-eurc': { underlying: ['2'], shares: '2' },
        'v-empty': { underlying: ['0'], shares: '0' },
      },
      prices: new Map([
        ['EURC', price('1.12')],
        ['XLM', price('0.195')],
      ]),
    });

    const summary = await service.summary('user-a');

    expect(summary.positions.map((p) => p.vaultId)).toEqual(['v-eurc']);
    expect(summary.totalUsd).toBe('2.24');
  });

  it('propagates staleness, so the screen can say the price is old', async () => {
    const { service } = createService({
      vaults: [vault('v-eurc', 'EURC')],
      positions: { 'v-eurc': { underlying: ['2'], shares: '2' } },
      prices: new Map([['EURC', price('1.12', 'STATIC', true)]]),
    });

    await expect(service.summary('user-a')).resolves.toMatchObject({
      stale: true,
      priceSource: 'STATIC',
    });
  });

  it('reports MIXED when prices came from different sources', async () => {
    const { service } = createService({
      vaults: [vault('v-eurc', 'EURC'), vault('v-xlm', 'XLM')],
      positions: {
        'v-eurc': { underlying: ['2'], shares: '2' },
        'v-xlm': { underlying: ['10'], shares: '10' },
      },
      prices: new Map([
        ['EURC', price('1.12', 'REFLECTOR')],
        ['XLM', price('0.195', 'STATIC', true)],
      ]),
    });

    await expect(service.summary('user-a')).resolves.toMatchObject({
      priceSource: 'MIXED',
    });
  });

  it('returns a zero total for a user with no vaults listed', async () => {
    const { service } = createService({ vaults: [] });

    await expect(service.summary('user-a')).resolves.toMatchObject({
      totalUsd: '0.0000',
      positions: [],
    });
  });

  it('404s a user with no active wallet', async () => {
    const { service } = createService({ wallet: null });

    await expect(service.summary('user-a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
