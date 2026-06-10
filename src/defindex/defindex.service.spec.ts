import { NotFoundException } from '@nestjs/common';
import { DefindexConfig } from './defindex.config';
import { DefindexService } from './defindex.service';

describe('DefindexService', () => {
  const vaultAddress = 'VAULT_ADDRESS';
  const rawVaultInfo = {
    name: 'USD Vault',
    symbol: 'dfUSD',
    apy: 8.5,
    assets: [],
    totalManagedFunds: [],
  };

  function createService(getVaultInfo: jest.Mock, cacheTtlMs = 300_000) {
    const config = {
      sdk: { getVaultInfo },
      baseUrl: 'https://api.defindex.test',
      timeoutMs: 10_000,
      apiKey: 'test-key',
      vaultInfoCacheTtlMs: cacheTtlMs,
    } as unknown as DefindexConfig;

    return new DefindexService(config);
  }

  it('deduplicates concurrent vault info requests', async () => {
    let resolveRequest: (value: typeof rawVaultInfo) => void;
    const upstreamRequest = new Promise<typeof rawVaultInfo>((resolve) => {
      resolveRequest = resolve;
    });
    const getVaultInfo = jest.fn().mockReturnValue(upstreamRequest);
    const service = createService(getVaultInfo);

    const first = service.getVaultInfo(vaultAddress);
    const second = service.getVaultInfo(vaultAddress);
    resolveRequest!(rawVaultInfo);

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ defindexVaultId: vaultAddress }),
      expect.objectContaining({ defindexVaultId: vaultAddress }),
    ]);
    expect(getVaultInfo).toHaveBeenCalledTimes(1);
  });

  it('serves vault info from cache within the configured TTL', async () => {
    const getVaultInfo = jest.fn().mockResolvedValue(rawVaultInfo);
    const service = createService(getVaultInfo);

    await service.getVaultInfo(vaultAddress);
    await service.getVaultInfo(vaultAddress);

    expect(getVaultInfo).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-rate-limit 4xx responses', async () => {
    const getVaultInfo = jest
      .fn()
      .mockRejectedValue({ statusCode: 404, message: 'Not found' });
    const service = createService(getVaultInfo);

    await expect(service.getVaultInfo(vaultAddress)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(getVaultInfo).toHaveBeenCalledTimes(1);
  });

  it('does not amplify rate limiting with immediate retries', async () => {
    const getVaultInfo = jest
      .fn()
      .mockRejectedValue({ statusCode: 429, message: 'Rate limit exceeded' });
    const service = createService(getVaultInfo);

    await expect(service.getVaultInfo(vaultAddress)).rejects.toThrow(
      'DeFindex rate limit exceeded',
    );
    expect(getVaultInfo).toHaveBeenCalledTimes(1);
  });
});
