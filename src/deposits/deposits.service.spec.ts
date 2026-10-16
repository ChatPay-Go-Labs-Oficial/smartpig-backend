import { BadRequestException, ConflictException } from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { Decimal } from '@prisma/client/runtime/library';
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
      findMany: jest.fn().mockResolvedValue([]),
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

  const conversions = {
    createConversion: jest.fn().mockResolvedValue({
      id: 'conv-1',
      unsignedXdr: 'AAAAconvert',
      sendAmount: '10.0000000',
      quotedDestAmount: '8.9852725',
      destMin: '8.9403461',
      sourceSymbol: 'USDC',
      targetSymbol: 'EURC',
    }),
    getConsumable: jest.fn(),
    attachDeposit: jest.fn().mockResolvedValue(undefined),
  };

  const service = new DepositsService(
    prisma as unknown as never,
    orchestrator as unknown as never,
    registry as unknown as never,
    disclosureGuard as unknown as never,
    conversions as unknown as never,
  );

  return {
    service,
    prisma,
    orchestrator,
    registry,
    disclosureGuard,
    conversions,
  };
}

describe('DepositsService.createDeposit', () => {
  describe('risk disclosure for non-USDC deposits', () => {
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

      const result = (await service.createDeposit(DTO)) as {
        unsignedXdr: string | null;
      };

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
        'EURC',
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

  describe('what the client is told', () => {
    const FUTURE = new Date(Date.now() + 86_400_000);
    const PAST = new Date(Date.now() - 86_400_000);

    function intentRow(over: Record<string, unknown> = {}) {
      return {
        id: 'intent-1',
        status: 'XDR_GENERATED',
        failureCode: null,
        errorMessage: null,
        expiresAt: FUTURE,
        transaction: null,
        ...over,
      };
    }

    it('projects a normalized state, not just the raw status', async () => {
      const { service, prisma } = createService();
      prisma.depositIntent.findUnique.mockResolvedValue(intentRow());

      const result = await service.getDeposit('intent-1');

      // The raw status stays for the published build; `state` is what new screens
      // render.
      expect(result.status).toBe('XDR_GENERATED');
      expect(result.state).toBe('PENDING_SIGNATURE');
    });

    it('exposes the txHash, so a failure is traceable', async () => {
      const { service, prisma } = createService();
      prisma.depositIntent.findUnique.mockResolvedValue(
        intentRow({
          status: 'SUBMITTED',
          transaction: { status: 'PENDING', txHash: 'abc123' },
        }),
      );

      const result = await service.getDeposit('intent-1');

      expect(result.txHash).toBe('abc123');
      expect(result.state).toBe('PENDING');
    });

    it('reports SUCCESS when the transaction confirmed before the intent caught up', async () => {
      const { service, prisma } = createService();
      prisma.depositIntent.findUnique.mockResolvedValue(
        intentRow({
          status: 'SUBMITTED',
          transaction: { status: 'CONFIRMED', txHash: 'abc123' },
        }),
      );

      await expect(service.getDeposit('intent-1')).resolves.toMatchObject({
        state: 'SUCCESS',
      });
    });

    it('reports EXPIRED for an intent never signed in time', async () => {
      const { service, prisma } = createService();
      prisma.depositIntent.findUnique.mockResolvedValue(
        intentRow({ expiresAt: PAST }),
      );

      await expect(service.getDeposit('intent-1')).resolves.toMatchObject({
        state: 'EXPIRED',
      });
    });

    it('separates a user-fixable failure from one needing support', async () => {
      const { service, prisma } = createService();

      prisma.depositIntent.findUnique.mockResolvedValue(
        intentRow({ status: 'FAILED', failureCode: 'NO_TRUSTLINE' }),
      );
      await expect(service.getDeposit('intent-1')).resolves.toMatchObject({
        state: 'REJECTED',
        failureCode: 'NO_TRUSTLINE',
      });

      prisma.depositIntent.findUnique.mockResolvedValue(
        intentRow({
          status: 'FAILED',
          failureCode: 'UPSTREAM_UNAVAILABLE',
        }),
      );
      await expect(service.getDeposit('intent-1')).resolves.toMatchObject({
        state: 'FAILED',
      });
    });

    it('404s an unknown intent', async () => {
      const { service, prisma } = createService();
      prisma.depositIntent.findUnique.mockResolvedValue(null);

      await expect(service.getDeposit('nope')).rejects.toThrow(/not found/);
    });
  });

  describe('submitSignedXdr returns what was actually written', () => {
    it('reports CONFIRMED rather than a hardcoded SUBMITTED', async () => {
      // The old code always answered SUBMITTED, so the client could not tell
      // "on chain" from "done" and the modal guessed.
      const { service, prisma, orchestrator } = createService();
      prisma.depositIntent.findUnique.mockResolvedValue({
        id: 'intent-1',
        status: 'XDR_GENERATED',
        failureCode: null,
        errorMessage: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      (
        orchestrator as unknown as {
          submitDeposit: jest.Mock;
        }
      ).submitDeposit = jest
        .fn()
        .mockResolvedValue({ txHash: 'tx-1', status: 'CONFIRMED' });

      await expect(
        service.submitSignedXdr('intent-1', { signedXdr: 'signed' }),
      ).resolves.toEqual({
        id: 'intent-1',
        txHash: 'tx-1',
        status: 'CONFIRMED',
      });
    });
  });

  describe('a failed XDR generation records why', () => {
    it('classifies the cause instead of only storing the message', async () => {
      const { service, prisma, orchestrator } = createService();
      orchestrator.buildDepositXdr.mockRejectedValue(new Error('ETIMEDOUT'));

      await expect(service.createDeposit(DTO)).rejects.toThrow('ETIMEDOUT');

      const [args] = prisma.depositIntent.update.mock.calls[0] as [
        { data: { failureCode: string; status: string } },
      ];
      expect(args.data.status).toBe('FAILED');
      // A timeout is upstream, not a chain rejection.
      expect(args.data.failureCode).toBe('UPSTREAM_UNAVAILABLE');
    });

    it('falls back to XDR_GENERATION_FAILED when the text says nothing', async () => {
      const { service, prisma, orchestrator } = createService();
      orchestrator.buildDepositXdr.mockRejectedValue(new Error('weird'));

      await expect(service.createDeposit(DTO)).rejects.toThrow('weird');

      const [args] = prisma.depositIntent.update.mock.calls[0] as [
        { data: { failureCode: string } },
      ];
      expect(args.data.failureCode).toBe('XDR_GENERATION_FAILED');
    });
  });

  describe('autoConvert turns an asset mismatch into a plan', () => {
    it('still rejects flatly without autoConvert, so old clients are unchanged', async () => {
      const { service, conversions } = createService();

      await expect(
        service.createDeposit({ ...DTO, assetSymbol: 'USDC' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(conversions.createConversion).not.toHaveBeenCalled();
    });

    it('returns the steps, with the deposit deferred', async () => {
      const { service } = createService();

      const result = (await service.createDeposit({
        ...DTO,
        assetSymbol: 'USDC',
        autoConvert: true,
      })) as {
        plan: {
          steps: { type: string; deferred?: boolean; id: string | null }[];
        };
      };

      expect(result.plan.steps.map((s) => s.type)).toEqual([
        'CONVERT',
        'DEPOSIT',
      ]);
      // The deposit cannot exist yet: DeFindex simulates the account state when
      // it builds that XDR, and the converted asset has not arrived.
      expect(result.plan.steps[1]).toMatchObject({ id: null, deferred: true });
    });

    it('persists no deposit intent, because the amount is still a quote', async () => {
      const { service, prisma, orchestrator } = createService();

      await service.createDeposit({
        ...DTO,
        assetSymbol: 'USDC',
        autoConvert: true,
      });

      expect(prisma.depositIntent.create).not.toHaveBeenCalled();
      expect(orchestrator.buildDepositXdr).not.toHaveBeenCalled();
    });

    it('converts into the vault asset and records what it is for', async () => {
      const { service, conversions } = createService();

      await service.createDeposit({
        ...DTO,
        assetSymbol: 'USDC',
        autoConvert: true,
      });

      expect(conversions.createConversion).toHaveBeenCalledWith(
        expect.objectContaining({
          toSymbol: 'EURC',
          amount: '2',
          plannedDeposit: { vaultId: 'vault-1', assetSymbol: 'EURC' },
        }),
      );
    });

    it('derives the conversion key from the deposit key, so a retry reuses it', async () => {
      // Otherwise retrying the same deposit opens a second conversion and the
      // user is asked to swap twice.
      const { service, conversions } = createService();

      await service.createDeposit({
        ...DTO,
        assetSymbol: 'USDC',
        autoConvert: true,
      });

      const [args] = conversions.createConversion.mock.calls[0] as [
        { idempotencyKey: string },
      ];
      expect(args.idempotencyKey).toBe(`conv:${DTO.idempotencyKey}`);
    });

    it('checks the disclosure before planning anything', async () => {
      const { service, conversions } = createService({
        disclosureThrows: new DisclosureNotAcknowledgedError('vault-1', 1, []),
      });

      await expect(
        service.createDeposit({
          ...DTO,
          assetSymbol: 'USDC',
          autoConvert: true,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(conversions.createConversion).not.toHaveBeenCalled();
    });
  });

  describe('createDepositFromConversion', () => {
    const FROM = {
      conversionId: 'conv-1',
      idempotencyKey: 'dep-from-conv',
      walletAccountId: 'wallet-1',
    };

    function consumable(received = '8.97123456789') {
      return {
        id: 'conv-1',
        vaultId: 'vault-1',
        targetSymbol: 'EURC',
        receivedAmount: new Decimal(received),
      };
    }

    it('sizes the deposit by what arrived, not by the quote', async () => {
      const { service, prisma, conversions } = createService();
      conversions.getConsumable.mockResolvedValue(consumable('8.9712345'));

      await service.createDepositFromConversion('user-1', FROM);

      const [{ data }] = prisma.depositIntent.create.mock.calls[0] as [
        { data: { amount: Decimal; assetSymbol: string } },
      ];
      expect(data.amount.toString()).toBe('8.9712345');
      expect(data.assetSymbol).toBe('EURC');
    });

    it('floors to the asset precision rather than rounding up', async () => {
      // Rounding up would claim more than the user holds and fail on chain.
      const { service, prisma, conversions } = createService();
      conversions.getConsumable.mockResolvedValue(consumable('8.99999999'));

      await service.createDepositFromConversion('user-1', FROM);

      const [{ data }] = prisma.depositIntent.create.mock.calls[0] as [
        { data: { amount: Decimal } },
      ];
      expect(data.amount.toString()).toBe('8.9999999');
    });

    it('links the conversion before generating the XDR', async () => {
      // If the XDR fails, the conversion is still consumed — otherwise the same
      // leftover balance would be offered to the user twice.
      const { service, conversions, orchestrator } = createService();
      conversions.getConsumable.mockResolvedValue(consumable());
      orchestrator.buildDepositXdr.mockRejectedValue(
        new Error('defindex down'),
      );

      await expect(
        service.createDepositFromConversion('user-1', FROM),
      ).rejects.toThrow('defindex down');

      expect(conversions.attachDeposit).toHaveBeenCalledWith(
        'conv-1',
        'intent-1',
      );
    });

    it('still enforces the disclosure', async () => {
      const { service, conversions, prisma } = createService({
        disclosureThrows: new DisclosureNotAcknowledgedError('vault-1', 1, []),
      });
      conversions.getConsumable.mockResolvedValue(consumable());

      await expect(
        service.createDepositFromConversion('user-1', FROM),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.depositIntent.create).not.toHaveBeenCalled();
    });

    it('refuses a conversion that yielded nothing', async () => {
      const { service, prisma, conversions } = createService();
      conversions.getConsumable.mockResolvedValue(consumable('0'));

      await expect(
        service.createDepositFromConversion('user-1', FROM),
      ).rejects.toThrow(/yielded nothing to deposit/);
      expect(prisma.depositIntent.create).not.toHaveBeenCalled();
    });

    it('is idempotent on the deposit key', async () => {
      const existing = { id: 'intent-existing', unsignedXdr: 'AAAAold' };
      const { service, conversions } = createService({
        existingIntent: existing,
      });

      await expect(
        service.createDepositFromConversion('user-1', FROM),
      ).resolves.toBe(existing);
      expect(conversions.getConsumable).not.toHaveBeenCalled();
    });
  });
});
