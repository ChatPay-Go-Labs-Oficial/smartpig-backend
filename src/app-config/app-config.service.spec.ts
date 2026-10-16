import { NotFoundException } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

describe('AppConfigService', () => {
  function createHarness() {
    const prisma = {
      appVersionConfig: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    const config = {
      get: jest.fn((key: string, fallback?: string) =>
        key === 'DEFINDEX_NETWORK' ? 'mainnet' : fallback,
      ),
    };

    return {
      service: new AppConfigService(prisma as any, config as any),
      prisma,
      config,
    };
  }

  it('returns the config for an existing platform', async () => {
    const { service, prisma } = createHarness();
    const config = {
      id: 'cfg-1',
      platform: 'IOS',
      minVersion: '1.0.0',
      latestVersion: '1.2.0',
      storeUrl: 'https://apps.apple.com/app/id6798366548',
    };
    prisma.appVersionConfig.findUnique.mockResolvedValue(config);

    await expect(service.getByPlatform('IOS' as any)).resolves.toEqual(config);
    expect(prisma.appVersionConfig.findUnique).toHaveBeenCalledWith({
      where: { platform: 'IOS' },
    });
  });

  it('throws NotFoundException when no config exists for the platform', async () => {
    const { service, prisma } = createHarness();
    prisma.appVersionConfig.findUnique.mockResolvedValue(null);

    await expect(
      service.getByPlatform('ANDROID' as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists all platform configs', async () => {
    const { service, prisma } = createHarness();
    const configs = [{ platform: 'IOS' }, { platform: 'ANDROID' }];
    prisma.appVersionConfig.findMany.mockResolvedValue(configs);

    await expect(service.listAll()).resolves.toEqual(configs);
  });

  it('updates the config for a platform with the given fields', async () => {
    const { service, prisma } = createHarness();
    const dto = { minVersion: '1.3.0' };
    const updated = { platform: 'IOS', minVersion: '1.3.0' };
    prisma.appVersionConfig.update.mockResolvedValue(updated);

    await expect(service.update('IOS' as any, dto)).resolves.toEqual(updated);
    expect(prisma.appVersionConfig.update).toHaveBeenCalledWith({
      where: { platform: 'IOS' },
      data: dto,
    });
  });

  describe('listAssets', () => {
    it('serves the registry for the active network', () => {
      const { service } = createHarness();

      const assets = service.listAssets();

      expect(assets.map((a) => a.symbol).sort()).toEqual([
        'EURC',
        'USDC',
        'XLM',
      ]);
    });

    it('includes what the app needs to format and to match a balance', () => {
      const { service } = createHarness();

      const eurc = service.listAssets().find((a) => a.symbol === 'EURC');

      expect(eurc).toMatchObject({
        code: 'EURC',
        decimals: 7,
        kind: 'CLASSIC',
        displayPrefix: '\u20ac',
        liteSymbol: 'EUR',
      });
      // CODE:ISSUER is how getWalletBalances reports a classic asset.
      expect(eurc?.assetId).toBe(`EURC:${eurc?.issuer ?? ''}`);
    });

    it('reports the native asset with a null issuer and a bare assetId', () => {
      const { service } = createHarness();

      const xlm = service.listAssets().find((a) => a.symbol === 'XLM');

      expect(xlm?.issuer).toBeNull();
      expect(xlm?.assetId).toBe('XLM');
    });

    it('marks exactly one funding asset, so the app knows what the ramp delivers', () => {
      const { service } = createHarness();

      const funding = service.listAssets().filter((a) => a.isFundingAsset);

      expect(funding).toHaveLength(1);
      expect(funding[0].symbol).toBe('USDC');
    });
  });
});
