import { ServiceUnavailableException } from '@nestjs/common';
import { QuoteService } from './quote.service';
import { readAssetRegistry } from '../config/asset-registry';

const MAINNET = readAssetRegistry('mainnet');
const USDC = MAINNET.find((a) => a.symbol === 'USDC')!;
const EURC = MAINNET.find((a) => a.symbol === 'EURC')!;
const XLM = MAINNET.find((a) => a.symbol === 'XLM')!;

function createService(
  records: { destination_amount: string; path?: unknown[] }[] | Error,
) {
  const get = jest.fn((args: { params: Record<string, string> }) => {
    void args;
    if (records instanceof Error) return Promise.reject(records);
    return Promise.resolve({ data: { _embedded: { records } } });
  });

  const config = {
    get: jest.fn((_k: string, fallback?: unknown) => fallback),
    getOrThrow: jest.fn().mockReturnValue('https://horizon.stellar.org'),
  };

  const service = new QuoteService(config as unknown as never);
  // The axios instance is created in the constructor; swap it for the stub.
  (service as unknown as { http: { get: unknown } }).http = { get };

  return { service, get };
}

describe('QuoteService', () => {
  describe('picking a route', () => {
    it('takes the best price, not the first record', () => {
      // Horizon does not order records by price. The dead swap.ts accepted
      // whichever came first, which silently hands the user a worse rate.
      const { service } = createService([
        { destination_amount: '8.9000000', path: [] },
        { destination_amount: '8.9852725', path: [] },
        { destination_amount: '8.9500000', path: [] },
      ]);

      return expect(
        service.quote({
          sourceAsset: USDC,
          targetAsset: EURC,
          sendAmount: '10',
        }),
      ).resolves.toMatchObject({ destAmount: '8.9852725' });
    });

    it('503s when no route exists at all', async () => {
      const { service } = createService([]);

      await expect(
        service.quote({
          sourceAsset: USDC,
          targetAsset: EURC,
          sendAmount: '10',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('503s when Horizon itself fails, rather than reporting a zero quote', async () => {
      const { service } = createService(new Error('ETIMEDOUT'));

      await expect(
        service.quote({
          sourceAsset: USDC,
          targetAsset: EURC,
          sendAmount: '10',
        }),
      ).rejects.toThrow(/Could not price the conversion/);
    });
  });

  describe('destMin is the on-chain protection', () => {
    it('applies the asset default of 50 bps for EURC', async () => {
      const { service } = createService([
        { destination_amount: '8.9852725', path: [] },
      ]);

      const quote = await service.quote({
        sourceAsset: USDC,
        targetAsset: EURC,
        sendAmount: '10',
      });

      // 8.9852725 × 0.995, truncated to 7 places.
      expect(quote.destMin).toBe('8.9403461');
      expect(quote.slippageBps).toBe(50);
    });

    it('applies the wider 100 bps default for XLM, which moves more', async () => {
      const { service } = createService([
        { destination_amount: '52.0234852', path: [] },
      ]);

      const quote = await service.quote({
        sourceAsset: USDC,
        targetAsset: XLM,
        sendAmount: '10',
      });

      expect(quote.slippageBps).toBe(100);
      expect(quote.destMin).toBe('51.5032503');
    });

    it('honours an explicit override', async () => {
      const { service } = createService([
        { destination_amount: '100.0000000', path: [] },
      ]);

      const quote = await service.quote({
        sourceAsset: USDC,
        targetAsset: EURC,
        sendAmount: '100',
        slippageBps: 200,
      });

      expect(quote.destMin).toBe('98.0000000');
    });

    it('rounds the floor down, never up', async () => {
      // Rounding up would set a floor above what the quote supports and fail a
      // conversion that should have gone through.
      const { service } = createService([
        { destination_amount: '8.9852729', path: [] },
      ]);

      const quote = await service.quote({
        sourceAsset: USDC,
        targetAsset: EURC,
        sendAmount: '10',
      });

      expect(quote.destMin).toBe('8.9403465');
    });

    it('is always below the estimate', async () => {
      const { service } = createService([
        { destination_amount: '898.2671733', path: [] },
      ]);

      const quote = await service.quote({
        sourceAsset: USDC,
        targetAsset: EURC,
        sendAmount: '1000',
      });

      expect(Number(quote.destMin)).toBeLessThan(Number(quote.destAmount));
    });
  });

  describe('the Horizon request', () => {
    it('asks strict-send, because the known quantity is what the user holds', async () => {
      const { service, get } = createService([
        { destination_amount: '8.9852725', path: [] },
      ]);

      await service.quote({
        sourceAsset: USDC,
        targetAsset: EURC,
        sendAmount: '10',
      });

      const [path, options] = get.mock.calls[0] as unknown as [
        string,
        { params: Record<string, string> },
      ];
      expect(path).toBe('/paths/strict-send');
      expect(options.params).toMatchObject({
        source_amount: '10.0000000',
        source_asset_type: 'credit_alphanum4',
        source_asset_code: 'USDC',
        source_asset_issuer: USDC.issuer as string,
        destination_assets: `EURC:${EURC.issuer as string}`,
      });
    });

    it('sends the native asset with no code or issuer', async () => {
      const { service, get } = createService([
        { destination_amount: '1.0000000', path: [] },
      ]);

      await service.quote({
        sourceAsset: XLM,
        targetAsset: EURC,
        sendAmount: '10',
      });

      const [, options] = get.mock.calls[0] as unknown as [
        string,
        { params: Record<string, string> },
      ];
      expect(options.params.source_asset_type).toBe('native');
      expect(options.params).not.toHaveProperty('source_asset_code');
    });

    it('names the native destination "native", not "XLM"', async () => {
      // Found against real Horizon: assetIdOf returns "XLM" — right for matching a
      // balance — but the path finder expects the literal "native" and silently
      // returns no route for anything else. This spec previously asserted "XLM"
      // and so codified the mistake.
      const { service, get } = createService([
        { destination_amount: '52.0000000', path: [] },
      ]);

      await service.quote({
        sourceAsset: USDC,
        targetAsset: XLM,
        sendAmount: '10',
      });

      const [, options] = get.mock.calls[0] as unknown as [
        string,
        { params: Record<string, string> },
      ];
      expect(options.params.destination_assets).toBe('native');
    });
  });

  describe('the route it reports', () => {
    it('describes a multi-hop route', async () => {
      const { service } = createService([
        {
          destination_amount: '8.9852725',
          path: [{ asset_type: 'native' }],
        },
      ]);

      const quote = await service.quote({
        sourceAsset: USDC,
        targetAsset: EURC,
        sendAmount: '10',
      });

      expect(quote.pathDescription).toEqual(['XLM']);
      expect(quote.path).toHaveLength(1);
    });

    it('reports a direct route as no hops', async () => {
      // What Horizon actually returns for both of our pairs today.
      const { service } = createService([
        { destination_amount: '8.9852725', path: [] },
      ]);

      const quote = await service.quote({
        sourceAsset: USDC,
        targetAsset: EURC,
        sendAmount: '10',
      });

      expect(quote.path).toEqual([]);
      expect(quote.pathDescription).toEqual([]);
    });
  });

  it('expires the quote, because the number is a market price', async () => {
    const { service } = createService([
      { destination_amount: '8.9852725', path: [] },
    ]);

    const before = Date.now();
    const quote = await service.quote({
      sourceAsset: USDC,
      targetAsset: EURC,
      sendAmount: '10',
    });

    expect(quote.expiresAt.getTime()).toBeGreaterThan(before);
    expect(quote.expiresAt.getTime()).toBeLessThanOrEqual(before + 61_000);
  });
});
