import { VaultRegistryService } from './vault-registry.service';
import {
  VaultDepositsPausedError,
  VaultNotFoundError,
} from './vault-registry.errors';

const EURC_VAULT = {
  id: 'vault-eurc',
  defindexVaultId: 'CBP2R5KYAWJCOCVDTSNTEVL3O6JBTWOOH7SZOX7DX5DLGVZCAMLBDZM3',
  name: 'Porquinho em Euro',
  assetSymbol: 'EURC',
  assetDecimals: 7,
  assetContractId: 'CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV',
  description: null,
  apy: null,
  tvl: null,
  protocol: 'DEFINDEX',
  depositsEnabled: true,
  isFeatured: false,
  displayOrder: 100,
  lastSyncedAt: null,
};

interface Options {
  vaults?: Record<string, unknown>[];
  allowedVaultIds?: string;
  currentVersions?: Map<string, { version: number; risks: unknown[] }>;
  acknowledged?: Map<string, Set<number>>;
  single?: Record<string, unknown> | null;
}

function createService(options: Options = {}) {
  const {
    vaults = [EURC_VAULT],
    allowedVaultIds = '',
    currentVersions = new Map([['vault-eurc', { version: 2, risks: [] }]]),
    acknowledged = new Map<string, Set<number>>(),
    single = null,
  } = options;

  let findManyArgs: Record<string, unknown> | null = null;

  const prisma = {
    vaultCatalog: {
      findMany: jest.fn((args: Record<string, unknown>) => {
        findManyArgs = args;
        return Promise.resolve(vaults);
      }),
      findUnique: jest.fn().mockResolvedValue(single),
    },
  };

  const config = {
    get: jest.fn((key: string, fallback?: string) =>
      key === 'ALLOWED_VAULT_IDS' ? allowedVaultIds : fallback,
    ),
  };

  const disclosures = {
    currentVersionsFor: jest.fn().mockResolvedValue(currentVersions),
    acknowledgedVersionsFor: jest.fn().mockResolvedValue(acknowledged),
    hasAcknowledgedCurrent: jest.fn().mockResolvedValue({
      acknowledged: false,
      current: null,
    }),
    findCurrent: jest.fn().mockResolvedValue(null),
  };

  const service = new VaultRegistryService(
    prisma as unknown as never,
    config as unknown as never,
    disclosures as unknown as never,
  );

  return {
    service,
    prisma,
    disclosures,
    getFindManyArgs: () => findManyArgs,
  };
}

describe('VaultRegistryService', () => {
  describe('listForUser', () => {
    it('lists only active vaults', async () => {
      const { service, getFindManyArgs } = createService();

      await service.listForUser('user-1');

      expect(getFindManyArgs()).toMatchObject({ where: { isActive: true } });
    });

    it('orders by displayOrder then name, so the hero is deterministic', async () => {
      // Ordering by name alone meant adding a vault silently reshuffled which one
      // the app treats as the featured one.
      const { service, getFindManyArgs } = createService();

      await service.listForUser('user-1');

      expect(getFindManyArgs()?.orderBy).toEqual([
        { displayOrder: 'asc' },
        { name: 'asc' },
      ]);
    });

    it('exposes assetDecimals, which the app previously hardcoded', async () => {
      const { service } = createService();

      const [vault] = await service.listForUser('user-1');

      expect(vault.assetDecimals).toBe(7);
    });

    it('honours the ALLOWED_VAULT_IDS allowlist while it is set', async () => {
      const { service, getFindManyArgs } = createService({
        allowedVaultIds: 'vault-eurc, vault-xlm',
      });

      await service.listForUser('user-1');

      expect(getFindManyArgs()).toMatchObject({
        where: { isActive: true, id: { in: ['vault-eurc', 'vault-xlm'] } },
      });
    });

    it('applies no allowlist when the variable is empty', async () => {
      const { service, getFindManyArgs } = createService({
        allowedVaultIds: '',
      });

      await service.listForUser('user-1');

      expect(getFindManyArgs()?.where).toEqual({ isActive: true });
    });

    it('reports an acknowledgment as required when the user has none', async () => {
      const { service } = createService({ acknowledged: new Map() });

      const [vault] = await service.listForUser('user-1');

      expect(vault.disclosure).toEqual({
        version: 2,
        acknowledgmentRequired: true,
      });
    });

    it('reports it as not required once the current version is accepted', async () => {
      const { service } = createService({
        acknowledged: new Map([['vault-eurc', new Set([2])]]),
      });

      const [vault] = await service.listForUser('user-1');

      expect(vault.disclosure).toEqual({
        version: 2,
        acknowledgmentRequired: false,
      });
    });

    it('still requires it when only an older version was accepted', async () => {
      const { service } = createService({
        acknowledged: new Map([['vault-eurc', new Set([1])]]),
      });

      const [vault] = await service.listForUser('user-1');

      expect(vault.disclosure?.acknowledgmentRequired).toBe(true);
    });

    it('leaves the requirement undefined for an anonymous caller', async () => {
      // "We did not check" is not the same claim as "nothing is required".
      const { service, disclosures } = createService();

      const [vault] = await service.listForUser(undefined);

      expect(vault.disclosure?.acknowledgmentRequired).toBeUndefined();
      expect(disclosures.acknowledgedVersionsFor).not.toHaveBeenCalled();
    });

    it('returns a null disclosure for a vault with none published', async () => {
      const { service } = createService({ currentVersions: new Map() });

      const [vault] = await service.listForUser('user-1');

      expect(vault.disclosure).toBeNull();
    });

    it('skips the disclosure queries entirely for an empty catalog', async () => {
      const { service, disclosures } = createService({ vaults: [] });

      await expect(service.listForUser('user-1')).resolves.toEqual([]);
      expect(disclosures.currentVersionsFor).not.toHaveBeenCalled();
    });
  });

  describe('assertDepositable', () => {
    it('returns the vault when it is active and accepting deposits', async () => {
      const { service } = createService({
        single: { ...EURC_VAULT, isActive: true, depositsEnabled: true },
      });

      await expect(
        service.assertDepositable('vault-eurc'),
      ).resolves.toMatchObject({
        assetSymbol: 'EURC',
        assetDecimals: 7,
      });
    });

    it('404s a delisted vault', async () => {
      const { service } = createService({
        single: { ...EURC_VAULT, isActive: false, depositsEnabled: true },
      });

      await expect(
        service.assertDepositable('vault-eurc'),
      ).rejects.toBeInstanceOf(VaultNotFoundError);
    });

    it('409s a vault whose deposits are paused', async () => {
      // Distinct from 404 on purpose: the vault exists and is still withdrawable.
      const { service } = createService({
        single: { ...EURC_VAULT, isActive: true, depositsEnabled: false },
      });

      await expect(
        service.assertDepositable('vault-eurc'),
      ).rejects.toBeInstanceOf(VaultDepositsPausedError);
    });

    it('404s an unknown vault', async () => {
      const { service } = createService({ single: null });

      await expect(service.assertDepositable('nope')).rejects.toBeInstanceOf(
        VaultNotFoundError,
      );
    });
  });

  describe('assertWithdrawable', () => {
    it('allows withdrawing from a vault with deposits paused', async () => {
      const { service } = createService({
        single: { ...EURC_VAULT, isActive: true, depositsEnabled: false },
      });

      await expect(
        service.assertWithdrawable('vault-eurc'),
      ).resolves.toMatchObject({
        id: 'vault-eurc',
      });
    });

    it('allows withdrawing from a delisted vault', async () => {
      // Someone holding a position must always be able to get out, even of a vault
      // we have since delisted. Pausing or delisting must never trap funds.
      const { service } = createService({
        single: { ...EURC_VAULT, isActive: false },
      });

      await expect(
        service.assertWithdrawable('vault-eurc'),
      ).resolves.toMatchObject({
        id: 'vault-eurc',
      });
    });

    it('still 404s a vault that does not exist', async () => {
      const { service } = createService({ single: null });

      await expect(service.assertWithdrawable('nope')).rejects.toBeInstanceOf(
        VaultNotFoundError,
      );
    });
  });

  describe('getOrThrow', () => {
    it('returns the configuration record for the detail screen', async () => {
      const configRecord = { vaultContractId: 'C…', risks: [] };
      const { service } = createService({
        single: {
          ...EURC_VAULT,
          isActive: true,
          isCurated: true,
          configRecord,
        },
      });

      await expect(service.getOrThrow('vault-eurc')).resolves.toMatchObject({
        configRecord,
      });
    });

    it('404s an inactive vault', async () => {
      const { service } = createService({
        single: { ...EURC_VAULT, isActive: false },
      });

      await expect(service.getOrThrow('vault-eurc')).rejects.toBeInstanceOf(
        VaultNotFoundError,
      );
    });
  });
});
