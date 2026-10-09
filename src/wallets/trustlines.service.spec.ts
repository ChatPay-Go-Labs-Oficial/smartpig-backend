import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TrustlinesService } from './trustlines.service';

const USER = 'user-a';
const WALLET = 'wallet-1';
const ADDRESS = `G${'A'.repeat(55)}`;
const EURC_ISSUER = 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2';
const EURC_ID = `EURC:${EURC_ISSUER}`;

const EURC = {
  symbol: 'EURC',
  code: 'EURC',
  issuer: EURC_ISSUER,
  kind: 'CLASSIC' as const,
};
const XLM = {
  symbol: 'XLM',
  code: 'XLM',
  issuer: null,
  kind: 'NATIVE' as const,
};

interface Options {
  wallet?: { id: string; stellarAddress: string; isActivated: boolean } | null;
  existing?: Record<string, unknown> | null;
  hasTrustline?: boolean;
  asset?: typeof EURC | typeof XLM;
  submitThrows?: Error;
}

function createService(options: Options = {}) {
  const {
    wallet = { id: WALLET, stellarAddress: ADDRESS, isActivated: true },
    existing = null,
    hasTrustline = false,
    asset = EURC,
    submitThrows,
  } = options;

  interface UpsertArgs {
    create?: Record<string, unknown>;
    update?: Record<string, unknown>;
  }
  const upserts: UpsertArgs[] = [];

  const prisma = {
    walletAccount: { findFirst: jest.fn().mockResolvedValue(wallet) },
    walletTrustline: {
      findUnique: jest.fn().mockResolvedValue(existing),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn((args: UpsertArgs) => {
        upserts.push(args);
        return Promise.resolve({ id: 'tl-1' });
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const stellar = {
    getAsset: jest.fn().mockReturnValue(asset),
    hasTrustline: jest.fn().mockResolvedValue(hasTrustline),
    buildSponsoredTrustlineXdr: jest.fn().mockResolvedValue('AAAAtrustline'),
    submitFeeBumpTransaction: submitThrows
      ? jest.fn().mockRejectedValue(submitThrows)
      : jest.fn().mockResolvedValue({ hash: 'tx-1' }),
  };

  return {
    service: new TrustlinesService(prisma as never, stellar as never),
    prisma,
    stellar,
    upserts,
  };
}

describe('TrustlinesService.ensureTrustline', () => {
  const base = { userId: USER, walletAccountId: WALLET, assetSymbol: 'EURC' };

  it('issues a sponsored XDR when the trustline is missing', async () => {
    const { service, stellar } = createService();

    const result = await service.ensureTrustline(base);

    expect(result).toMatchObject({
      required: true,
      assetId: EURC_ID,
      unsignedXdr: 'AAAAtrustline',
    });
    expect(stellar.buildSponsoredTrustlineXdr).toHaveBeenCalledWith(
      ADDRESS,
      EURC,
    );
  });

  it('answers "not required" when the line already exists', async () => {
    // The deposit flow calls this before every deposit into a non-funding asset,
    // so "already done" is the normal answer, not an error.
    const { service, stellar } = createService({ hasTrustline: true });

    const result = await service.ensureTrustline(base);

    expect(result).toMatchObject({ required: false, unsignedXdr: null });
    expect(stellar.buildSponsoredTrustlineXdr).not.toHaveBeenCalled();
  });

  it('records a trustline opened by another client, to stop re-reading Horizon', async () => {
    const { service, upserts } = createService({ hasTrustline: true });

    await service.ensureTrustline(base);

    expect(upserts[0].create?.status).toBe('ACTIVE');
  });

  it('needs nothing for the native asset', async () => {
    const { service, stellar } = createService({ asset: XLM });

    const result = await service.ensureTrustline({
      ...base,
      assetSymbol: 'XLM',
    });

    expect(result).toMatchObject({ required: false, assetId: 'XLM' });
    // Never touches Horizon: XLM has no trustline to check.
    expect(stellar.hasTrustline).not.toHaveBeenCalled();
  });

  it('refuses a wallet that was never activated', async () => {
    const { service } = createService({
      wallet: { id: WALLET, stellarAddress: ADDRESS, isActivated: false },
    });

    await expect(service.ensureTrustline(base)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("404s a wallet that is not the caller's", async () => {
    const { service } = createService({ wallet: null });

    await expect(service.ensureTrustline(base)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reuses an XDR still inside its time bound', async () => {
    // Issuing a fresh one would strand the previous signature mid-flow.
    const { service, stellar } = createService({
      existing: {
        status: 'PENDING_SIGNATURE',
        unsignedXdr: 'AAAAcached',
        expiresAt: new Date(Date.now() + 300_000),
      },
    });

    const result = await service.ensureTrustline(base);

    expect(result.unsignedXdr).toBe('AAAAcached');
    expect(stellar.buildSponsoredTrustlineXdr).not.toHaveBeenCalled();
  });

  it('issues a new XDR once the cached one expired', async () => {
    const { service, stellar } = createService({
      existing: {
        status: 'PENDING_SIGNATURE',
        unsignedXdr: 'AAAAstale',
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const result = await service.ensureTrustline(base);

    expect(result.unsignedXdr).toBe('AAAAtrustline');
    expect(stellar.buildSponsoredTrustlineXdr).toHaveBeenCalled();
  });

  it('does not reuse the XDR of a failed attempt', async () => {
    const { service, stellar } = createService({
      existing: {
        status: 'FAILED',
        unsignedXdr: 'AAAAfailed',
        expiresAt: new Date(Date.now() + 300_000),
      },
    });

    await service.ensureTrustline(base);

    expect(stellar.buildSponsoredTrustlineXdr).toHaveBeenCalled();
  });
});

describe('TrustlinesService.submitTrustline', () => {
  const base = {
    userId: USER,
    walletAccountId: WALLET,
    assetSymbol: 'EURC',
    signedXdr: 'AAAAsigned',
  };

  it('submits through the fee bump, pinned to the XDR we issued', async () => {
    // The hash pin is what stops the client changing the operation: it may add a
    // signature and nothing else.
    const { service, stellar } = createService({
      existing: {
        id: 'tl-1',
        status: 'PENDING_SIGNATURE',
        unsignedXdr: 'AAAAissued',
      },
    });

    const result = await service.submitTrustline(base);

    expect(stellar.submitFeeBumpTransaction).toHaveBeenCalledWith(
      'AAAAsigned',
      'AAAAissued',
    );
    expect(result).toEqual({
      assetId: EURC_ID,
      txHash: 'tx-1',
      status: 'ACTIVE',
    });
  });

  it('clears the spent XDR, so it cannot be replayed', async () => {
    const { service, upserts } = createService({
      existing: {
        id: 'tl-1',
        status: 'PENDING_SIGNATURE',
        unsignedXdr: 'AAAAissued',
      },
    });

    await service.submitTrustline(base);

    expect(upserts[0].update).toMatchObject({
      unsignedXdr: null,
      status: 'ACTIVE',
    });
  });

  it('is idempotent once the trustline is active', async () => {
    const { service, stellar } = createService({
      existing: {
        id: 'tl-1',
        status: 'ACTIVE',
        unsignedXdr: 'AAAAissued',
        txHash: 'tx-old',
      },
    });

    await expect(service.submitTrustline(base)).resolves.toEqual({
      assetId: EURC_ID,
      txHash: 'tx-old',
      status: 'ACTIVE',
    });
    expect(stellar.submitFeeBumpTransaction).not.toHaveBeenCalled();
  });

  it('rejects a submit for an asset no XDR was issued for', async () => {
    const { service } = createService({ existing: null });

    await expect(service.submitTrustline(base)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('treats "already exists" as success, not failure', async () => {
    // Horizon answers op_already_exists when the line landed through another
    // path. The submit failed, but the caller wanted a trustline and has one —
    // reporting an error would send them round the loop again for nothing.
    const { service, upserts } = createService({
      existing: {
        id: 'tl-1',
        status: 'PENDING_SIGNATURE',
        unsignedXdr: 'AAAAissued',
        txHash: null,
      },
      submitThrows: new Error('op_already_exists'),
      hasTrustline: true,
    });

    await expect(service.submitTrustline(base)).resolves.toMatchObject({
      status: 'ACTIVE',
    });
    expect(upserts[0].update?.status).toBe('ACTIVE');
  });

  it('records the failure and rethrows when the line really is missing', async () => {
    const { service, prisma } = createService({
      existing: {
        id: 'tl-1',
        status: 'PENDING_SIGNATURE',
        unsignedXdr: 'AAAAissued',
      },
      submitThrows: new Error('tx_bad_auth'),
      hasTrustline: false,
    });

    await expect(service.submitTrustline(base)).rejects.toThrow('tx_bad_auth');
    const [args] = prisma.walletTrustline.update.mock.calls[0] as [
      { data: { status: string; errorMessage: string } },
    ];
    expect(args.data.status).toBe('FAILED');
    expect(args.data.errorMessage).toBe('tx_bad_auth');
  });
});
