import { BadRequestException, ConflictException } from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { DisclosureNotAcknowledgedError } from '../vault-registry/vault-registry.errors';

const VAULT = {
  id: 'vault-1',
  defindexVaultId: 'CBP2R5KYAWJCOCVDTSNTEVL3O6JBTWOOH7SZOX7DX5DLGVZCAMLBDZM3',
  assetSymbol: 'EURC',
  assetDecimals: 7,
  isActive: true,
  depositsEnabled: true,
  protocol: 'DEFINDEX',
};

const DTO = {
  idempotencyKey: 'deposit-key',
  userId: 'user-1',
  walletAccountId: 'wallet-1',
  vaultId: 'vault-1',
  amount: '2',
  assetSymbol: 'EURC',
};

interface Options {
  vault?: Partial<typeof VAULT> | null;
  /** Thrown by assertDepositable, to exercise paused / delisted vaults. */
  depositableThrows?: Error;
  /** Thrown by the disclosure gate. Undefined means the user has acknowledged. */
  disclosureThrows?: Error;
  wallet?: { id: string } | null;
  existingIntent?: Record<string, unknown> | null;
}

function createService(options: Options = {}) {
  const {
    vault = VAULT,
    depositableThrows,
    disclosureThrows,
    wallet = { id: 'wallet-1' },
    existingIntent = null,
  } = options;

  const prisma = {
    depositIntent: {
      findUnique: jest.fn().mockResolvedValue(existingIntent),
      create: jest.fn().mockResolvedValue({ id: 'intent-1', ...DTO }),
      update: jest.fn().mockResolvedValue({}),
    },
    walletAccount: {
      findFirst: jest.fn().mockResolvedValue(wallet),
    },
  };

  const orchestrator = {
    buildDepositXdr: jest.fn().mockResolvedValue('AAAAunsigned'),
  };

  const registry = {
    assertDepositable: depositableThrows
      ? jest.fn().mockRejectedValue(depositableThrows)
      : jest.fn().mockResolvedValue({ ...VAULT, ...vault }),
  };

  const disclosureGuard = {
    assertAcknowledged: disclosureThrows
      ? jest.fn().mockRejectedValue(disclosureThrows)
      : jest.fn().mockResolvedValue(undefined),
  };

  const service = new DepositsService(
    prisma as unknown as never,
    orchestrator as unknown as never,
    registry as unknown as never,
    disclosureGuard as unknown as never,
  );

  return { service, prisma, orchestrator, registry, disclosureGuard };
}

describe('DepositsService.createDeposit', () => {
  describe('risk disclosure must be acknowledged before the first deposit', () => {
    it('rejects with 409 DISCLOSURE_NOT_ACKNOWLEDGED', async () => {
      const risks = [
        { code: 'SMART_CONTRACT' as const, severity: 'HIGH' as const },
      ];
      const { service } = createService({
        disclosureThrows: new DisclosureNotAcknowledgedError(
          'vault-1',
          3,
          risks,
        ),
      });

      const error = await service.createDeposit(DTO).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      const body = (error as ConflictException).getResponse() as {
        code: string;
        details: { vaultId: string; version: number; risks: unknown[] };
      };
      expect(body.code).toBe('DISCLOSURE_NOT_ACKNOWLEDGED');
      // The rejection carries what to display, so the app can open the sheet
      // without a second round trip.
      expect(body.details).toMatchObject({
        vaultId: 'vault-1',
        version: 3,
        risks,
      });
    });

    it('does not create an intent when consent is missing', async () => {
      const { service, prisma, orchestrator } = createService({
        disclosureThrows: new DisclosureNotAcknowledgedError('vault-1', 1, []),
      });

      await expect(service.createDeposit(DTO)).rejects.toBeInstanceOf(
        ConflictException,
      );

      // Nothing persisted and no XDR generated: a blocked deposit leaves no trace.
      expect(prisma.depositIntent.create).not.toHaveBeenCalled();
      expect(orchestrator.buildDepositXdr).not.toHaveBeenCalled();
    });

    it('proceeds once the disclosure has been acknowledged', async () => {
      const { service, prisma, orchestrator } = createService();

      const result = await service.createDeposit(DTO);

      expect(prisma.depositIntent.create).toHaveBeenCalled();
      expect(orchestrator.buildDepositXdr).toHaveBeenCalledWith('intent-1');
      expect(result.unsignedXdr).toBe('AAAAunsigned');
    });

    it('checks consent for the caller and the vault of this request', async () => {
      // Separation per user and per vault lives in the composite unique key; what
      // this asserts is that the service asks about the right pair.
      const { service, disclosureGuard } = createService();

      await service.createDeposit({
        ...DTO,
        userId: 'user-9',
        vaultId: 'vault-1',
      });

      expect(disclosureGuard.assertAcknowledged).toHaveBeenCalledWith(
        'user-9',
        'vault-1',
      );
    });

    it('gates consent before validating the asset symbol', async () => {
      // Order matters: a user who has not consented should be told that, not handed
      // an asset-mismatch message that sends them down the wrong path.
      const { service, disclosureGuard } = createService({
        disclosureThrows: new DisclosureNotAcknowledgedError('vault-1', 1, []),
      });

      await expect(
        service.createDeposit({ ...DTO, assetSymbol: 'USDC' }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(disclosureGuard.assertAcknowledged).toHaveBeenCalled();
    });
  });

  describe('vault state', () => {
    it('rejects an asset that does not match the vault', async () => {
      const { service, prisma } = createService();

      await expect(
        service.createDeposit({ ...DTO, assetSymbol: 'USDC' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.depositIntent.create).not.toHaveBeenCalled();
    });

    it('compares asset symbols case-insensitively', async () => {
      const { service, prisma } = createService();

      await service.createDeposit({ ...DTO, assetSymbol: 'eurc' });

      expect(prisma.depositIntent.create).toHaveBeenCalled();
    });

    it('surfaces a paused vault instead of creating an intent', async () => {
      const paused = new ConflictException({
        message: 'paused',
        code: 'VAULT_DEPOSITS_PAUSED',
      });
      const { service, prisma, disclosureGuard } = createService({
        depositableThrows: paused,
      });

      await expect(service.createDeposit(DTO)).rejects.toBe(paused);

      expect(prisma.depositIntent.create).not.toHaveBeenCalled();
      // Vault usability is settled before we ask about consent.
      expect(disclosureGuard.assertAcknowledged).not.toHaveBeenCalled();
    });

    it('persists the vault asset symbol, not the one the client sent', async () => {
      const { service, prisma } = createService();

      await service.createDeposit({ ...DTO, assetSymbol: 'eurc' });

      const [{ data }] = prisma.depositIntent.create.mock.calls[0] as [
        { data: { assetSymbol: string } },
      ];
      expect(data.assetSymbol).toBe('EURC');
    });
  });

  describe('idempotency', () => {
    it('returns the existing intent without re-checking consent', async () => {
      // A retry of a deposit already created must not fail because a new
      // disclosure version was published in the meantime.
      const existing = { id: 'intent-existing', unsignedXdr: 'AAAAold' };
      const { service, disclosureGuard, orchestrator } = createService({
        existingIntent: existing,
      });

      await expect(service.createDeposit(DTO)).resolves.toBe(existing);

      expect(disclosureGuard.assertAcknowledged).not.toHaveBeenCalled();
      expect(orchestrator.buildDepositXdr).not.toHaveBeenCalled();
    });
  });

  describe('XDR generation failure', () => {
    it('marks the intent FAILED and rethrows', async () => {
      const { service, prisma, orchestrator } = createService();
      orchestrator.buildDepositXdr.mockRejectedValue(
        new Error('defindex down'),
      );

      await expect(service.createDeposit(DTO)).rejects.toThrow('defindex down');

      const [args] = prisma.depositIntent.update.mock.calls[0] as [
        {
          where: { id: string };
          data: { status: string; errorMessage: string };
        },
      ];
      expect(args.where).toEqual({ id: 'intent-1' });
      expect(args.data.status).toBe('FAILED');
      expect(args.data.errorMessage).toBe('defindex down');
    });
  });
});
