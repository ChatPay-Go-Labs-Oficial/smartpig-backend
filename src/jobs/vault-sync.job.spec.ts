import { VaultSyncJob } from './vault-sync.job';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexService } from '../defindex/defindex.service';

it('preserves operator disablement when syncing and normalizes native to XLM', async () => {
  const upsert = jest.fn<
    Promise<unknown>,
    [
      {
        create: { isActive: boolean };
        update: { assetSymbol: string; isActive?: boolean };
      },
    ]
  >();
  const prisma = { vaultCatalog: { upsert } };
  const defindex = {
    discoverVaults: jest
      .fn()
      .mockResolvedValue({ vaults: [{ address: 'CVAULT', apy: 0 }] }),
    getVaultInfo: jest
      .fn()
      .mockResolvedValue({ name: 'XLM', assetSymbol: 'native', tvl: '10' }),
  };
  await new VaultSyncJob(
    prisma as unknown as PrismaService,
    defindex as unknown as DefindexService,
  ).syncVaultsFromDefindex();
  expect(upsert.mock.calls[0][0].create.isActive).toBe(false);
  expect(upsert.mock.calls[0][0].update).not.toHaveProperty('isActive');
  expect(upsert.mock.calls[0][0].update.assetSymbol).toBe('XLM');
});
