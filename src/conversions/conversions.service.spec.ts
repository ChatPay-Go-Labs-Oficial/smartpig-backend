import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Asset } from '@stellar/stellar-sdk';
import { ConversionsService } from './conversions.service';
import { readAssetRegistry } from '../config/asset-registry';

const MAINNET = readAssetRegistry('mainnet');
const USDC = MAINNET.find((a) => a.symbol === 'USDC')!;
const EURC = MAINNET.find((a) => a.symbol === 'EURC')!;
const XLM = MAINNET.find((a) => a.symbol === 'XLM')!;

const USER = 'user-a';
const WALLET = 'wallet-1';
const ADDRESS = `G${'A'.repeat(55)}`;

interface Options {
  mode?: 'DEX' | 'DISABLED';
  wallet?: { id: string; stellarAddress: string } | null;
  existingByKey?: Record<string, unknown> | null;
  conversion?: Record<string, unknown> | null;
  trustlineRequired?: boolean;
  submitThrows?: Error;
  received?: Decimal | null;
  buildThrows?: Error;
}

function createService(options: Options = {}) {
  const {
    mode = 'DEX',
    wallet = { id: WALLET, stellarAddress: ADDRESS },
    existingByKey = null,
    conversion = null,
    trustlineRequired = false,
    submitThrows,
    received = new Decimal('8.9850000'),
    buildThrows,
  } = options;

  const updates: Record<string, unknown>[] = [];

  const prisma = {
    assetConversion: {
      findUnique: jest.fn((args: { where: { idempotencyKey?: string } }) =>
        Promise.resolve(args.where.idempotencyKey ? existingByKey : conversion),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'conv-1' }),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return Promise.resolve({ id: 'conv-1', ...data });
      }),
    },
    walletAccount: {
      findFirst: jest.fn().mockResolvedValue(wallet),
      findUnique: jest.fn().mockResolvedValue(wallet),
    },
    vaultCatalog: {
      findFirst: jest.fn().mockResolvedValue({ id: 'vault-eurc' }),
    },
  };

  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key === 'CONVERSION_MODE' ? mode : fallback,
    ),
  };

  const stellar = {
    getAsset: jest.fn((symbol: string) => {
      const normalized = symbol.toUpperCase();
      if (normalized === 'USDC') return USDC;
      if (normalized === 'XLM') return XLM;
      return EURC;
    }),
    getFundingAsset: jest.fn().mockReturnValue(USDC),
    toStellarAsset: jest.fn(() => new Asset(EURC.code, EURC.issuer as string)),
    buildPathPaymentXdr: buildThrows
      ? jest.fn().mockRejectedValue(buildThrows)
      : jest.fn().mockResolvedValue('AAAApathpayment'),
    submitFeeBumpTransaction: submitThrows
      ? jest.fn().mockRejectedValue(submitThrows)
      : jest.fn().mockResolvedValue({ hash: 'tx-1' }),
    readPathPaymentReceived: jest.fn().mockResolvedValue(received),
  };

  const quotes = {
    quote: jest.fn().mockResolvedValue({
      sourceAsset: USDC,
      targetAsset: EURC,
      sendAmount: '10.0000000',
      destAmount: '8.9852725',
      destMin: '8.9403461',
      slippageBps: 50,
      path: [],
      pathDescription: [],
      expiresAt: new Date(Date.now() + 60_000),
    }),
  };

  const trustlines = {
    ensureTrustline: jest.fn().mockResolvedValue({
      required: trustlineRequired,
      assetId: `EURC:${EURC.issuer as string}`,
      unsignedXdr: trustlineRequired ? 'AAAAtrustline' : null,
      expiresAt: null,
    }),
  };
  const eligibility = {
    assertEligibleForDeposit: jest.fn().mockResolvedValue({ eligible: true }),
  };

  return {
    service: new ConversionsService(
      prisma as never,
      config as never,
      stellar as never,
      quotes as never,
      trustlines as never,
      eligibility as never,
    ),
    prisma,
    stellar,
    quotes,
    trustlines,
    eligibility,
    updates,
  };
}

const CREATE = {
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
  userId: USER,
  walletAccountId: WALLET,
  toSymbol: 'EURC',
  amount: '10',
};

describe('ConversionsService.quote', () => {
  it('defaults the source to the funding asset', async () => {
    const { service, stellar } = createService();

    await service.quote({ toSymbol: 'EURC', amount: '10' });

    expect(stellar.getFundingAsset).toHaveBeenCalled();
  });

  it('reports the estimate and the on-chain floor separately', async () => {
    const { service } = createService();

    await expect(
      service.quote({ toSymbol: 'EURC', amount: '10' }),
    ).resolves.toMatchObject({
      estimatedReceive: '8.9852725',
      minReceive: '8.9403461',
      slippageBps: 50,
    });
  });

  it('refuses converting an asset into itself', async () => {
    const { service } = createService();

    await expect(
      service.quote({ fromSymbol: 'USDC', toSymbol: 'USDC', amount: '10' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('503s when conversion is turned off', async () => {
    // DISABLED is the honest degradation for a pair with no usable market.
    const { service } = createService({ mode: 'DISABLED' });

    await expect(
      service.quote({ toSymbol: 'EURC', amount: '10' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('ConversionsService.createConversion', () => {
  it('persists the intent and returns the XDR to authorize', async () => {
    const { service, stellar, updates } = createService();

    await service.createConversion(CREATE);

    expect(stellar.buildPathPaymentXdr).toHaveBeenCalledWith(
      expect.objectContaining({
        userAddress: ADDRESS,
        sendAmount: '10.0000000',
        destMin: '8.9403461',
      }),
    );
    expect(updates[0]).toMatchObject({
      unsignedXdr: 'AAAApathpayment',
      status: 'XDR_GENERATED',
    });
  });

  it('checks Lite education access before converting into EURC', async () => {
    const { service, eligibility } = createService();

    await service.createConversion(CREATE);

    expect(eligibility.assertEligibleForDeposit).toHaveBeenCalledWith(
      USER,
      'vault-eurc',
      'EURC',
    );
  });

  it('uses the selected source asset for a standalone wallet swap', async () => {
    const { service, stellar, quotes } = createService();

    await service.createConversion({
      ...CREATE,
      fromSymbol: 'XLM',
      toSymbol: 'USDC',
    });

    expect(stellar.getFundingAsset).not.toHaveBeenCalled();
    expect(quotes.quote).toHaveBeenCalledWith(
      expect.objectContaining({ sourceAsset: XLM, targetAsset: USDC }),
    );
  });

  it('demands the trustline before moving anything', async () => {
    // A payment into an untrusted asset fails with op_no_trust, so this has to be
    // settled first — and the 409 carries the trustline XDR so the app can resolve
    // it without another round trip.
    const { service, stellar } = createService({ trustlineRequired: true });

    const error = await service
      .createConversion(CREATE)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    const body = (error as ConflictException).getResponse() as {
      code: string;
      details: { unsignedXdr: string };
    };
    expect(body.code).toBe('TRUSTLINE_REQUIRED');
    expect(body.details.unsignedXdr).toBe('AAAAtrustline');
    expect(stellar.buildPathPaymentXdr).not.toHaveBeenCalled();
  });

  it('records what the conversion was for, so an orphan is resumable', async () => {
    const { service, prisma } = createService();

    await service.createConversion({
      ...CREATE,
      plannedDeposit: { vaultId: 'vault-eurc', assetSymbol: 'EURC' },
    });

    const [{ data }] = prisma.assetConversion.create.mock.calls[0] as [
      { data: { plannedDeposit: unknown } },
    ];
    expect(data.plannedDeposit).toEqual({
      vaultId: 'vault-eurc',
      assetSymbol: 'EURC',
    });
  });

  it('returns the existing intent for a repeated idempotency key', async () => {
    const { service, stellar } = createService({
      existingByKey: { id: 'conv-existing' },
    });

    await expect(service.createConversion(CREATE)).resolves.toMatchObject({
      id: 'conv-existing',
    });
    expect(stellar.buildPathPaymentXdr).not.toHaveBeenCalled();
  });

  it("404s a wallet that is not the caller's", async () => {
    const { service } = createService({ wallet: null });

    await expect(service.createConversion(CREATE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('marks the intent FAILED when the XDR cannot be built', async () => {
    const { service, updates } = createService({
      buildThrows: new Error('ETIMEDOUT'),
    });

    await expect(service.createConversion(CREATE)).rejects.toThrow('ETIMEDOUT');

    expect(updates[0]).toMatchObject({
      status: 'FAILED',
      failureCode: 'UPSTREAM_UNAVAILABLE',
    });
  });
});

describe('ConversionsService.submitConversion', () => {
  const pending = {
    id: 'conv-1',
    userId: USER,
    walletAccountId: WALLET,
    status: 'XDR_GENERATED',
    unsignedXdr: 'AAAAissued',
    expiresAt: new Date(Date.now() + 300_000),
    targetSymbol: 'EURC',
  };

  const submit = { id: 'conv-1', userId: USER, signedXdr: 'AAAAsigned' };

  it('submits pinned to the XDR we issued', async () => {
    const { service, stellar } = createService({ conversion: pending });

    await service.submitConversion(submit);

    expect(stellar.submitFeeBumpTransaction).toHaveBeenCalledWith(
      'AAAAsigned',
      'AAAAissued',
    );
  });

  it('records what arrived, read from the chain and not from the quote', async () => {
    // The deposit that follows is sized by this number, so it has to be the real
    // one — the quote is a prediction.
    const { service, updates } = createService({
      conversion: pending,
      received: new Decimal('8.9712345'),
    });

    await service.submitConversion(submit);

    const confirmed = updates.find((u) => u.status === 'CONFIRMED');
    expect(confirmed?.txHash).toBe('tx-1');
    expect((confirmed?.receivedAmount as Decimal).toString()).toBe('8.9712345');
  });

  it('still confirms when the received amount could not be read', async () => {
    // The transaction landed; refusing to confirm it would be worse than not
    // knowing the exact figure.
    const { service, updates } = createService({
      conversion: pending,
      received: null,
    });

    await service.submitConversion(submit);

    const confirmed = updates.find((u) => u.status === 'CONFIRMED');
    expect(confirmed).toBeDefined();
    expect(confirmed?.receivedAmount).toBeUndefined();
  });

  it.each([
    ['CONFIRMED', 'already confirmed'],
    ['SUBMITTED', 'already submitted'],
  ])('409s an intent that is %s', async (status, message) => {
    const { service } = createService({
      conversion: { ...pending, status },
    });

    await expect(service.submitConversion(submit)).rejects.toThrow(
      new RegExp(message),
    );
  });

  it('rejects a FAILED intent', async () => {
    const { service } = createService({
      conversion: { ...pending, status: 'FAILED' },
    });

    await expect(service.submitConversion(submit)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('expires an intent signed too late, and records why', async () => {
    const { service, updates } = createService({
      conversion: { ...pending, expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(service.submitConversion(submit)).rejects.toThrow(
      /has expired/,
    );
    expect(updates[0]).toMatchObject({
      status: 'FAILED',
      failureCode: 'INTENT_EXPIRED',
    });
  });

  it('404s a conversion belonging to another user', async () => {
    // The intent exists, but not for this caller.
    const { service } = createService({
      conversion: { ...pending, userId: 'someone-else' },
    });

    await expect(service.submitConversion(submit)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('marks the intent FAILED and rethrows when the chain rejects it', async () => {
    const { service, updates } = createService({
      conversion: pending,
      submitThrows: new Error('op_under_destmin'),
    });

    await expect(service.submitConversion(submit)).rejects.toThrow(
      'op_under_destmin',
    );
    // Slippage is user-actionable: the app offers a retry, not support.
    expect(updates.at(-1)).toMatchObject({
      status: 'FAILED',
      failureCode: 'SLIPPAGE_EXCEEDED',
    });
  });
});

describe('ConversionsService.listPending', () => {
  it('asks only for conversions that landed without their deposit', async () => {
    const { service, prisma } = createService();

    await service.listPending(USER);

    const [args] = prisma.assetConversion.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(args.where).toMatchObject({
      userId: USER,
      status: 'CONFIRMED',
      depositIntentId: null,
    });
  });
});

describe('Conversion eligibility rollout compatibility', () => {
  it('allows conversion without an education vault while enforcement is disabled', async () => {
    const { service, prisma, eligibility } = createService();
    prisma.vaultCatalog.findFirst.mockResolvedValue(null as never);
    await expect(service.createConversion(CREATE)).resolves.toBeDefined();
    expect(eligibility.assertEligibleForDeposit).not.toHaveBeenCalled();
  });
});
