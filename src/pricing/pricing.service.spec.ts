import { Decimal } from '@prisma/client/runtime/library';
import { PricingService } from './pricing.service';

const FRESH = new Date(Date.now() - 2 * 60 * 1000);
const STALE = new Date(Date.now() - 60 * 60 * 1000);

interface Options {
  mode?: string;
  staticPrices?: string;
  reflectorAvailable?: boolean;
  quote?: { priceUsd: Decimal; asOf: Date } | null;
}

function createService(options: Options = {}) {
  const {
    mode = 'REFLECTOR',
    staticPrices = '',
    reflectorAvailable = true,
    quote = { priceUsd: new Decimal('1.120578'), asOf: FRESH },
  } = options;

  const values: Record<string, string> = {
    DEFINDEX_NETWORK: 'mainnet',
    PRICING_MODE: mode,
    PRICING_STATIC_USD: staticPrices,
  };

  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
    ),
  };

  const reflector = {
    available: reflectorAvailable,
    getPrice: jest.fn().mockResolvedValue(quote),
  };

  return {
    service: new PricingService(config as never, reflector as never),
    reflector,
  };
}

describe('PricingService', () => {
  describe('reading from the oracle', () => {
    it('prices an asset and reports the source', async () => {
      const { service } = createService();

      const price = await service.getUsdPrice('EURC');

      expect(price?.priceUsd.toString()).toBe('1.120578');
      expect(price?.source).toBe('REFLECTOR');
      expect(price?.stale).toBe(false);
    });

    it('resolves DeFindex\'s "native" to XLM', async () => {
      const { service, reflector } = createService();

      const price = await service.getUsdPrice('native');

      expect(price?.symbol).toBe('XLM');
      // And it asked the oracle for the ticker XLM, not the string "native".
      const [args] = reflector.getPrice.mock.calls[0] as [{ asset: string }];
      expect(args.asset).toBe('XLM');
    });

    it('flags a price older than we vouch for', async () => {
      const { service } = createService({
        quote: { priceUsd: new Decimal('1.12'), asOf: STALE },
      });

      await expect(service.getUsdPrice('EURC')).resolves.toMatchObject({
        stale: true,
      });
    });

    it('caches, because the deposit and portfolio paths both ask', async () => {
      const { service, reflector } = createService();

      await service.getUsdPrice('EURC');
      await service.getUsdPrice('EURC');

      expect(reflector.getPrice).toHaveBeenCalledTimes(1);
    });

    it('returns null rather than inventing a number', async () => {
      // A portfolio that says "we could not price this" is honest; one that
      // substitutes a guess misreports someone's money.
      const { service } = createService({ quote: null });

      await expect(service.getUsdPrice('EURC')).resolves.toBeNull();
    });

    it('returns null for an asset the registry does not know', async () => {
      const { service } = createService();

      await expect(service.getUsdPrice('CETES')).resolves.toBeNull();
    });
  });

  describe('the STATIC escape hatch', () => {
    it('uses the configured constant', async () => {
      const { service, reflector } = createService({
        mode: 'STATIC',
        staticPrices: 'USDC=1,EURC=1.12,XLM=0.19',
      });

      const price = await service.getUsdPrice('EURC');

      expect(price?.priceUsd.toString()).toBe('1.12');
      expect(price?.source).toBe('STATIC');
      expect(reflector.getPrice).not.toHaveBeenCalled();
    });

    it('always marks a constant stale, so nothing presents it as a market price', async () => {
      const { service } = createService({
        mode: 'STATIC',
        staticPrices: 'EURC=1.12',
      });

      await expect(service.getUsdPrice('EURC')).resolves.toMatchObject({
        stale: true,
      });
    });

    it('falls back to STATIC when the oracle has no RPC to talk to', async () => {
      // The mode then describes what will actually happen, instead of claiming
      // REFLECTOR and silently failing every read.
      const { service } = createService({
        mode: 'REFLECTOR',
        reflectorAvailable: false,
        staticPrices: 'EURC=1.12',
      });

      await expect(service.getUsdPrice('EURC')).resolves.toMatchObject({
        source: 'STATIC',
      });
    });

    it('covers for an oracle read that failed', async () => {
      const { service } = createService({
        quote: null,
        staticPrices: 'EURC=1.12',
      });

      await expect(service.getUsdPrice('EURC')).resolves.toMatchObject({
        source: 'STATIC',
      });
    });

    it('returns null when STATIC has nothing for the asset', async () => {
      const { service } = createService({
        mode: 'STATIC',
        staticPrices: 'USDC=1',
      });

      await expect(service.getUsdPrice('EURC')).resolves.toBeNull();
    });

    it('ignores an unparseable entry instead of crashing on boot', async () => {
      const { service } = createService({
        mode: 'STATIC',
        staticPrices: 'EURC=abc,XLM=0.19',
      });

      // The bad entry is dropped; the good one on the same line survives.
      await expect(service.getUsdPrice('EURC')).resolves.toBeNull();
      const xlm = await service.getUsdPrice('XLM');
      expect(xlm?.priceUsd.toString()).toBe('0.19');
    });
  });

  describe('getUsdPrices', () => {
    it('reads each asset once, however many times it is asked for', async () => {
      const { service, reflector } = createService();

      await service.getUsdPrices(['EURC', 'EURC', 'XLM']);

      expect(reflector.getPrice).toHaveBeenCalledTimes(2);
    });

    it('is keyed by the canonical symbol and by what was asked', async () => {
      // A caller holding DeFindex's "native" and one holding "XLM" must both
      // find the entry, or the position silently reports no value.
      const { service } = createService();

      const prices = await service.getUsdPrices(['native']);

      expect(prices.get('XLM')).toBeDefined();
      expect(prices.get('NATIVE')).toBeDefined();
      expect(prices.get('XLM')).toBe(prices.get('NATIVE'));
    });

    it('omits what it could not price, rather than entering a zero', async () => {
      const { service } = createService({ quote: null });

      await expect(service.getUsdPrices(['EURC'])).resolves.toEqual(new Map());
    });
  });
});
