import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service';
import type { ConfirmDeletionDto } from './dto/deletion.dto';

const USER = 'user-a';
const PRIVY = 'did:privy:user-a';
const REQUEST = 'req-1';
const KEY = '11111111-1111-4111-8111-111111111111';
const ADDRESS = `G${'A'.repeat(55)}`;

const ACKS: ConfirmDeletionDto = {
  signedXdr: 'AAAAAgSIGNED',
  acknowledgements: {
    dataRetention: true,
    onchainHistoryPublic: true,
    irreversible: true,
  },
};

const RESIDUALS = {
  walletUsdc: '0.003',
  walletAssets: [],
  vaultShares: [],
  sweptToTreasuryUsd: '0.003',
  permanentlyLostUsd: '0.0000004',
};

interface Options {
  eligible?: boolean;
  existingRequest?: Record<string, unknown> | null;
  request?: Record<string, unknown> | null;
  wallet?: { stellarAddress: string; isActivated: boolean } | null;
  receiver?: { blindpayReceiverId: string } | null;
  failOnChain?: boolean;
  failScrub?: boolean;
  failBlindPay?: boolean;
  failIdentity?: boolean;
}

function createService(options: Options = {}) {
  const {
    eligible = true,
    existingRequest = null,
    request = {
      id: REQUEST,
      userId: USER,
      status: 'PENDING_SIGNATURE',
      closureUnsignedXdr: 'AAAAAgUNSIGNED',
      errorMessage: null,
      createdAt: new Date('2026-09-05T12:00:00.000Z'),
      updatedAt: new Date('2026-09-05T12:00:00.000Z'),
    },
    wallet = { stellarAddress: ADDRESS, isActivated: true },
    receiver = { blindpayReceiverId: 'cus-1' },
    failOnChain = false,
    failScrub = false,
    failBlindPay = false,
    failIdentity = false,
  } = options;

  const updates: Record<string, unknown>[] = [];

  const prisma = {
    accountDeletionRequest: {
      findUnique: jest.fn(({ where }: { where: { id?: string } }) =>
        Promise.resolve(where.id ? request : existingRequest),
      ),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        ...request,
        status: 'COMPLETED',
        updatedAt: new Date('2026-09-05T12:05:00.000Z'),
      }),
      create: jest.fn().mockResolvedValue({
        id: REQUEST,
        closureUnsignedXdr: null,
        createdAt: new Date('2026-09-05T12:00:00.000Z'),
      }),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return Promise.resolve({
          id: REQUEST,
          closureUnsignedXdr: 'AAAAAgUNSIGNED',
          createdAt: new Date('2026-09-05T12:00:00.000Z'),
          ...data,
        });
      }),
    },
    walletAccount: { findFirst: jest.fn().mockResolvedValue(wallet) },
    blindPayReceiver: { findUnique: jest.fn().mockResolvedValue(receiver) },
  };

  const eligibility = {
    check: jest.fn().mockResolvedValue({
      eligible,
      blockers: eligible ? [] : [{ code: 'WALLET_USDC_BALANCE' }],
      residuals: RESIDUALS,
      warnings: [],
    }),
  };

  const scrub = {
    scrub: failScrub
      ? jest.fn().mockRejectedValue(new Error('scrub exploded'))
      : jest.fn().mockResolvedValue(undefined),
  };

  const stellar = {
    buildAccountClosureXdr: jest.fn().mockResolvedValue({
      xdr: 'AAAAAgUNSIGNED',
      sweptAmount: '0.003',
      sweptAssetSymbol: 'USDC',
    }),
    submitFeeBumpTransaction: failOnChain
      ? jest.fn().mockRejectedValue(new Error('op_cannot_delete'))
      : jest.fn().mockResolvedValue({ hash: 'tx-closure' }),
  };

  const blindpay = {
    deleteCustomer: failBlindPay
      ? jest.fn().mockRejectedValue(new Error('blindpay down'))
      : jest.fn().mockResolvedValue(undefined),
  };

  const identity = {
    deleteUser: failIdentity
      ? jest.fn().mockRejectedValue(new Error('privy down'))
      : jest.fn().mockResolvedValue(undefined),
  };

  return {
    prisma,
    eligibility,
    scrub,
    stellar,
    blindpay,
    identity,
    updates,
    service: new AccountDeletionService(
      prisma as never,
      eligibility as never,
      scrub as never,
      stellar as never,
      blindpay as never,
      identity,
    ),
  };
}

/** The status written by the last update that set one. */
function lastStatus(updates: Record<string, unknown>[]): unknown {
  return [...updates].reverse().find((u) => 'status' in u)?.status;
}

describe('AccountDeletionService · request', () => {
  it('builds the closure transaction and leaves the request awaiting signature', async () => {
    const { service, stellar, updates } = createService();

    const result = await service.requestDeletion(USER, KEY);

    expect(stellar.buildAccountClosureXdr).toHaveBeenCalledWith(ADDRESS);
    expect(lastStatus(updates)).toBe('PENDING_SIGNATURE');
    expect(result.closureXdr).toBe('AAAAAgUNSIGNED');
  });

  it('skips the on-chain step when the wallet was never activated', async () => {
    const { service, stellar } = createService({
      wallet: { stellarAddress: ADDRESS, isActivated: false },
    });

    const result = await service.requestDeletion(USER, KEY);

    expect(stellar.buildAccountClosureXdr).not.toHaveBeenCalled();
    expect(result.closureXdr).toBeNull();
  });

  it('refuses to open a request for an account that is not eligible', async () => {
    const { service, prisma } = createService({ eligible: false });

    await expect(service.requestDeletion(USER, KEY)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.accountDeletionRequest.create).not.toHaveBeenCalled();
  });

  it('returns the existing request when the idempotency key repeats', async () => {
    const { service, prisma } = createService({
      existingRequest: {
        id: REQUEST,
        userId: USER,
        closureUnsignedXdr: 'AAAAAgUNSIGNED',
        createdAt: new Date('2026-09-05T12:00:00.000Z'),
      },
    });

    const result = await service.requestDeletion(USER, KEY);

    expect(result.requestId).toBe(REQUEST);
    expect(prisma.accountDeletionRequest.create).not.toHaveBeenCalled();
  });

  it('refuses an idempotency key that belongs to another account', async () => {
    const { service } = createService({
      existingRequest: { id: REQUEST, userId: 'user-b' },
    });

    await expect(service.requestDeletion(USER, KEY)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('reports residuals from the live check, not from the stored row', async () => {
    // Vault dust is not stored anywhere, and these numbers are what the consent
    // screen tells the user they are about to lose.
    const { service } = createService();

    const result = await service.requestDeletion(USER, KEY);

    expect(result.residuals).toEqual({
      sweptToTreasuryUsd: '0.003',
      permanentlyLostUsd: '0.0000004',
    });
  });
});

describe('AccountDeletionService · confirm', () => {
  it('runs the five steps and completes', async () => {
    const { service, stellar, scrub, blindpay, identity } = createService();

    const result = await service.confirmDeletion(USER, PRIVY, REQUEST, ACKS);

    expect(stellar.submitFeeBumpTransaction).toHaveBeenCalled();
    expect(scrub.scrub).toHaveBeenCalledWith(USER);
    expect(blindpay.deleteCustomer).toHaveBeenCalledWith('cus-1');
    expect(identity.deleteUser).toHaveBeenCalledWith(PRIVY);
    expect(result.status).toBe('COMPLETED');
  });

  it('re-checks eligibility and refuses if it changed since the request', async () => {
    // A Pix can land between opening the request and confirming it. This is the
    // check that actually authorises the deletion.
    const { service, scrub, stellar } = createService({ eligible: false });

    await expect(
      service.confirmDeletion(USER, PRIVY, REQUEST, ACKS),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(stellar.submitFeeBumpTransaction).not.toHaveBeenCalled();
    expect(scrub.scrub).not.toHaveBeenCalled();
  });

  it('refuses a request that belongs to another account', async () => {
    const { service } = createService({
      request: { id: REQUEST, userId: 'user-b', status: 'PENDING_SIGNATURE' },
    });

    await expect(
      service.confirmDeletion(USER, PRIVY, REQUEST, ACKS),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('demands the signature when there is a transaction to close', async () => {
    const { service, scrub } = createService();

    await expect(
      service.confirmDeletion(USER, PRIVY, REQUEST, {
        acknowledgements: ACKS.acknowledgements,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(scrub.scrub).not.toHaveBeenCalled();
  });

  it('answers 200 on a request already completed, instead of an error', async () => {
    // The app may have lost the response. Reporting a failure over a deletion
    // that worked would be worse than repeating the good news.
    const {
      service: s2,
      scrub,
      stellar,
      identity,
    } = createService({
      request: {
        id: REQUEST,
        userId: USER,
        status: 'COMPLETED',
        closureUnsignedXdr: null,
        updatedAt: new Date('2026-09-05T12:05:00.000Z'),
      },
    });

    const result = await s2.confirmDeletion(USER, PRIVY, REQUEST, ACKS);

    expect(result.status).toBe('COMPLETED');
    // And it short-circuits: nothing is executed a second time.
    expect(stellar.submitFeeBumpTransaction).not.toHaveBeenCalled();
    expect(scrub.scrub).not.toHaveBeenCalled();
    expect(identity.deleteUser).not.toHaveBeenCalled();
  });

  it('refuses a request that already failed', async () => {
    const { service } = createService({
      request: {
        id: REQUEST,
        userId: USER,
        status: 'FAILED',
        errorMessage: 'op_cannot_delete',
        closureUnsignedXdr: null,
        updatedAt: new Date(),
      },
    });

    await expect(
      service.confirmDeletion(USER, PRIVY, REQUEST, ACKS),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('persists the acknowledgements with the moment they were given', async () => {
    const { service, updates } = createService();

    await service.confirmDeletion(USER, PRIVY, REQUEST, ACKS);

    const acks = updates.find((u) => 'acknowledgements' in u)
      ?.acknowledgements as Record<string, unknown>;
    expect(acks).toMatchObject({
      dataRetention: true,
      onchainHistoryPublic: true,
      irreversible: true,
    });
    expect(typeof acks.acceptedAt).toBe('string');
  });
});

describe('AccountDeletionService · failure injected at each step', () => {
  it('step 2, on-chain: marks FAILED, answers 503 and never reaches the scrub', async () => {
    const { service, scrub, updates } = createService({ failOnChain: true });

    await expect(
      service.confirmDeletion(USER, PRIVY, REQUEST, ACKS),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(scrub.scrub).not.toHaveBeenCalled();
    expect(lastStatus(updates)).toBe('FAILED');
  });

  it('step 3, scrub: propagates and never marks the account as scrubbed', async () => {
    // The on-chain account is already closed at this point, but the data is
    // untouched — the transaction rolled back. It needs a human to look.
    const { service, blindpay, identity, updates } = createService({
      failScrub: true,
    });

    await expect(
      service.confirmDeletion(USER, PRIVY, REQUEST, ACKS),
    ).rejects.toThrow('scrub exploded');

    expect(updates.map((u) => u.status)).not.toContain('LOCAL_SCRUBBED');
    expect(blindpay.deleteCustomer).not.toHaveBeenCalled();
    expect(identity.deleteUser).not.toHaveBeenCalled();
  });

  it('step 4, BlindPay: carries on to Privy and leaves the rest to the job', async () => {
    // A regulated partner being down must not keep a person from leaving.
    const { service, identity, updates } = createService({
      failBlindPay: true,
    });

    await service.confirmDeletion(USER, PRIVY, REQUEST, ACKS);

    expect(identity.deleteUser).toHaveBeenCalled();
    const last = updates[updates.length - 1];
    expect(last).not.toHaveProperty('blindpayDeletedAt');
    expect(last).not.toHaveProperty('status');
  });

  it('step 5, Privy: stays LOCAL_SCRUBBED so the job can retry', async () => {
    const { service, updates } = createService({ failIdentity: true });

    await service.confirmDeletion(USER, PRIVY, REQUEST, ACKS);

    const last = updates[updates.length - 1];
    expect(last).not.toHaveProperty('privyDeletedAt');
    expect(last).not.toHaveProperty('status');
    expect(lastStatus(updates)).toBe('LOCAL_SCRUBBED');
  });

  it('an account without a BlindPay customer counts that step as done', async () => {
    const { service, blindpay, updates } = createService({ receiver: null });

    await service.confirmDeletion(USER, PRIVY, REQUEST, ACKS);

    expect(blindpay.deleteCustomer).not.toHaveBeenCalled();
    expect(lastStatus(updates)).toBe('COMPLETED');
  });
});
