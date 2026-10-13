import { ConflictException } from '@nestjs/common';
import { VaultRegistryAdminService } from './vault-registry.admin.service';

const VAULT_ID = 'vault-1';

interface Options {
  vault?: { id: string; isActive: boolean } | null;
  /** The currently published disclosure, or null when there is none. */
  current?: { id: string; version: number } | null;
}

function createService(options: Options = {}) {
  const {
    vault = { id: VAULT_ID, isActive: false },
    current = { id: 'd1', version: 1 },
  } = options;

  const updates: Record<string, unknown>[] = [];
  const updateManyCalls: Record<string, unknown>[] = [];

  const prisma = {
    vaultCatalog: {
      findUnique: jest.fn().mockResolvedValue(vault),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return Promise.resolve({ id: VAULT_ID, ...data });
      }),
      updateMany: jest.fn((args: Record<string, unknown>) => {
        updateManyCalls.push(args);
        return Promise.resolve({ count: 1 });
      }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'new-vault', ...data }),
      ),
      findMany: jest.fn().mockResolvedValue([]),
    },
    vaultDisclosure: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest
        .fn()
        .mockResolvedValue(current ? { version: current.version } : null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'd-new', ...data }),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ version: 2, ...data }),
      ),
    },
  };

  const disclosures = {
    findCurrent: jest.fn().mockResolvedValue(current),
    currentVersionsFor: jest.fn().mockResolvedValue(new Map()),
    invalidate: jest.fn(),
  };

  const service = new VaultRegistryAdminService(
    prisma as unknown as never,
    disclosures as unknown as never,
  );

  return { service, prisma, disclosures, updates, updateManyCalls };
}

describe('VaultRegistryAdminService', () => {
  describe('runtime activation', () => {
    it('activates a vault that has a published disclosure', async () => {
      const { service, updates } = createService();

      await service.update(VAULT_ID, { isActive: true });

      expect(updates[0]).toMatchObject({ isActive: true });
    });

    it('refuses to activate a vault with no published disclosure', async () => {
      // Otherwise an operator could list a vault users are then blocked from
      // depositing into at the very last step.
      const { service, prisma } = createService({ current: null });

      await expect(
        service.update(VAULT_ID, { isActive: true }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.vaultCatalog.update).not.toHaveBeenCalled();
    });

    it('deactivates without requiring a disclosure', async () => {
      // Switching a vault off must never be blocked; that is the emergency control.
      const { service, updates } = createService({
        vault: { id: VAULT_ID, isActive: true },
        current: null,
      });

      await service.update(VAULT_ID, { isActive: false });

      expect(updates[0]).toMatchObject({ isActive: false });
    });

    it('does not re-check the disclosure for an already active vault', async () => {
      const { service, disclosures } = createService({
        vault: { id: VAULT_ID, isActive: true },
      });

      await service.update(VAULT_ID, { isActive: true, displayOrder: 1 });

      expect(disclosures.findCurrent).not.toHaveBeenCalled();
    });

    it('pauses deposits while leaving the vault listed', async () => {
      // depositsEnabled is separate from isActive precisely so freezing new money
      // does not also block withdrawals.
      const { service, updates } = createService({
        vault: { id: VAULT_ID, isActive: true },
      });

      await service.update(VAULT_ID, { depositsEnabled: false });

      expect(updates[0]).toEqual({ depositsEnabled: false });
      expect(updates[0]).not.toHaveProperty('isActive');
    });

    it('404s for a vault that does not exist', async () => {
      const { service } = createService({ vault: null });

      await expect(
        service.update(VAULT_ID, { isActive: true }),
      ).rejects.toThrow(/not found/);
    });
  });

  describe('curated metadata', () => {
    it('marks the row curated when display metadata is edited', async () => {
      // Without this the discovery job would undo the operator's edit within six
      // hours.
      const { service, updates } = createService({
        vault: { id: VAULT_ID, isActive: true },
      });

      await service.update(VAULT_ID, { name: 'Porquinho em Euro' });

      expect(updates[0]).toMatchObject({
        name: 'Porquinho em Euro',
        isCurated: true,
      });
    });

    it('respects an explicit isCurated: false', async () => {
      const { service, updates } = createService({
        vault: { id: VAULT_ID, isActive: true },
      });

      await service.update(VAULT_ID, { name: 'x', isCurated: false });

      expect(updates[0]).toMatchObject({ isCurated: false });
    });

    it('does not curate a row when only ordering changes', async () => {
      const { service, updates } = createService({
        vault: { id: VAULT_ID, isActive: true },
      });

      await service.update(VAULT_ID, { displayOrder: 5 });

      expect(updates[0]).not.toHaveProperty('isCurated');
    });

    it('rejects an invalid config record instead of persisting it', async () => {
      const { service, prisma } = createService({
        vault: { id: VAULT_ID, isActive: true },
      });

      await expect(
        service.update(VAULT_ID, { configRecord: { vaultContractId: 'nope' } }),
      ).rejects.toThrow(/is invalid/);
      expect(prisma.vaultCatalog.update).not.toHaveBeenCalled();
    });
  });

  describe('featured vault', () => {
    it('unfeatures the others, so the hero is deterministic', async () => {
      const { service, updateManyCalls } = createService({
        vault: { id: VAULT_ID, isActive: true },
      });

      await service.update(VAULT_ID, { isFeatured: true });

      expect(updateManyCalls[0]).toMatchObject({
        where: { isFeatured: true, id: { not: VAULT_ID } },
        data: { isFeatured: false },
      });
    });

    it('does not touch the others when unfeaturing', async () => {
      const { service, prisma } = createService({
        vault: { id: VAULT_ID, isActive: true },
      });

      await service.update(VAULT_ID, { isFeatured: false });

      expect(prisma.vaultCatalog.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('importing a vault DeFindex deployed', () => {
    it('lands it inactive and curated', async () => {
      const { service, prisma } = createService();
      prisma.vaultCatalog.findUnique.mockResolvedValue(null);

      const created = await service.import({
        defindexVaultId:
          'CBP2R5KYAWJCOCVDTSNTEVL3O6JBTWOOH7SZOX7DX5DLGVZCAMLBDZM3',
        name: 'Peridot EURC',
        assetSymbol: 'EURC',
      });

      expect(created).toMatchObject({ isActive: false });
      const [{ data }] = prisma.vaultCatalog.create.mock.calls[0] as [
        {
          data: { isCurated: boolean; assetDecimals: number; protocol: string };
        },
      ];
      expect(data.isCurated).toBe(true);
      expect(data.assetDecimals).toBe(7);
      expect(data.protocol).toBe('DEFINDEX');
    });

    it('refuses a duplicate registration', async () => {
      const { service } = createService();

      await expect(
        service.import({
          defindexVaultId:
            'CBP2R5KYAWJCOCVDTSNTEVL3O6JBTWOOH7SZOX7DX5DLGVZCAMLBDZM3',
          name: 'x',
          assetSymbol: 'EURC',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('publishing disclosures', () => {
    it('takes the next version when none is given', async () => {
      const { service, prisma } = createService();

      await service.createDisclosure(VAULT_ID, {
        risks: [{ code: 'SMART_CONTRACT', severity: 'HIGH' }],
      });

      const [{ data }] = prisma.vaultDisclosure.create.mock.calls[0] as [
        { data: { version: number; publishedAt: Date | null } },
      ];
      // findFirst reports v1 exists, so the next one is 2.
      expect(data.version).toBe(2);
      expect(data.publishedAt).toBeNull();
    });

    it('rejects an unknown risk code before it can reach the app', async () => {
      const { service, prisma } = createService();

      await expect(
        service.createDisclosure(VAULT_ID, {
          risks: [{ code: 'NOT_A_RISK', severity: 'HIGH' }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.vaultDisclosure.create).not.toHaveBeenCalled();
    });

    it('rejects an empty risk list', async () => {
      const { service } = createService();

      await expect(
        service.createDisclosure(VAULT_ID, { risks: [] }),
      ).rejects.toThrow(/Invalid risks/);
    });

    it('invalidates the cache when created already published', async () => {
      const { service, disclosures, prisma } = createService();
      prisma.vaultDisclosure.create.mockResolvedValue({
        id: 'd-new',
        version: 2,
        publishedAt: new Date(),
      } as never);

      await service.createDisclosure(VAULT_ID, {
        risks: [{ code: 'FEES', severity: 'INFO' }],
        publish: true,
      });

      expect(disclosures.invalidate).toHaveBeenCalledWith(VAULT_ID);
    });

    it('republishing keeps the original timestamp', async () => {
      // That moment is when the text became binding.
      const publishedAt = new Date('2026-10-01T00:00:00.000Z');
      const { service, prisma } = createService();
      prisma.vaultDisclosure.findUnique.mockResolvedValue({
        id: 'd1',
        publishedAt,
      });

      await expect(
        service.publishDisclosure(VAULT_ID, 1),
      ).resolves.toMatchObject({
        publishedAt,
      });
      expect(prisma.vaultDisclosure.update).not.toHaveBeenCalled();
    });

    it('refuses to publish a version that does not exist', async () => {
      const { service } = createService();

      await expect(
        service.publishDisclosure(VAULT_ID, 9),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
