import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Account,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { StellarService } from './stellar.service';

describe('StellarService fee sponsorship', () => {
  const treasury = Keypair.random();
  const user = Keypair.random();
  const configValues: Record<string, string | number> = {
    DEFINDEX_NETWORK: 'testnet',
    STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    STELLAR_USDC_ASSET_CODE: 'USDC',
    STELLAR_USDC_ISSUER: Keypair.random().publicKey(),
    STELLAR_FEE_BUMP_BASE_FEE: 500,
    TREASURY_STELLAR_SECRET: treasury.secret(),
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key in configValues ? configValues[key] : fallback,
    ),
    getOrThrow: jest.fn((key: string) => {
      if (!(key in configValues)) throw new Error(`Missing ${key}`);
      return configValues[key];
    }),
  } as unknown as ConfigService;

  function buildUserTransaction(dataValue: string) {
    const tx = new TransactionBuilder(new Account(user.publicKey(), '1'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.manageData({ name: 'test', value: dataValue }))
      .setTimeout(60)
      .build();
    const unsignedXdr = tx.toXDR();
    tx.sign(user);
    return { unsignedXdr, signedXdr: tx.toXDR() };
  }

  it('builds a treasury-signed fee bump around the expected user transaction', () => {
    const service = new StellarService(config);
    const { unsignedXdr, signedXdr } = buildUserTransaction('expected');

    const sponsoredXdr = service.buildSponsoredFeeBumpXdr(
      signedXdr,
      unsignedXdr,
    );
    const feeBump = TransactionBuilder.fromXDR(
      sponsoredXdr,
      Networks.TESTNET,
    ) as FeeBumpTransaction;

    expect(feeBump.feeSource).toBe(treasury.publicKey());
    expect(feeBump.signatures).toHaveLength(1);
    expect(feeBump.innerTransaction.signatures).toHaveLength(1);
  });

  it('rejects a signed transaction different from the generated XDR', () => {
    const service = new StellarService(config);
    const expected = buildUserTransaction('expected');
    const different = buildUserTransaction('different');

    expect(() =>
      service.buildSponsoredFeeBumpXdr(
        different.signedXdr,
        expected.unsignedXdr,
      ),
    ).toThrow(BadRequestException);
  });

  it('retries a fee bump with a higher fee after tx_insufficient_fee', async () => {
    const service = new StellarService(config);
    const { signedXdr } = buildUserTransaction('retry-fee');
    const server = (service as any).server;
    server.feeStats = jest.fn().mockResolvedValue({
      fee_charged: { p90: '600' },
    });
    server.submitTransaction = jest
      .fn()
      .mockRejectedValueOnce({
        response: {
          data: {
            title: 'Transaction Failed',
            extras: {
              result_codes: { transaction: 'tx_insufficient_fee' },
            },
          },
        },
      })
      .mockResolvedValueOnce({ hash: 'activation-hash' });

    await expect(service.submitFeeBumpTransaction(signedXdr)).resolves.toEqual({
      hash: 'activation-hash',
    });
    expect(server.submitTransaction).toHaveBeenCalledTimes(2);

    const firstFee = Number(
      (server.submitTransaction.mock.calls[0][0] as FeeBumpTransaction).fee,
    );
    const secondFee = Number(
      (server.submitTransaction.mock.calls[1][0] as FeeBumpTransaction).fee,
    );
    expect(secondFee).toBeGreaterThan(firstFee);
  });

  it('returns the translated Horizon transaction code', async () => {
    const service = new StellarService(config);
    const { signedXdr } = buildUserTransaction('bad-auth');
    const server = (service as any).server;
    server.feeStats = jest.fn().mockResolvedValue({
      fee_charged: { p90: '100' },
    });
    server.submitTransaction = jest.fn().mockRejectedValue({
      response: {
        data: {
          title: 'Transaction Failed',
          extras: { result_codes: { transaction: 'tx_bad_auth' } },
        },
      },
    });

    await expect(service.submitFeeBumpTransaction(signedXdr)).rejects.toThrow(
      'Transaction failed: Assinatura inválida',
    );
  });
});

describe('StellarService account closure', () => {
  const treasury = Keypair.random();
  const user = Keypair.random();
  const usdcIssuer = Keypair.random().publicKey();
  const tesouroIssuer = Keypair.random().publicKey();

  function createService(options: { tesouro?: boolean } = {}) {
    const values: Record<string, string | number> = {
      DEFINDEX_NETWORK: 'testnet',
      STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
      STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
      STELLAR_USDC_ASSET_CODE: 'USDC',
      STELLAR_USDC_ISSUER: usdcIssuer,
      TREASURY_STELLAR_SECRET: treasury.secret(),
    };
    if (options.tesouro) {
      values.STELLAR_TESOURO_ASSET_CODE = 'TESOURO';
      values.STELLAR_TESOURO_ISSUER = tesouroIssuer;
    }

    const config = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key in values ? values[key] : fallback,
      ),
      getOrThrow: jest.fn((key: string) => {
        if (!(key in values)) throw new Error(`Missing ${key}`);
        return values[key];
      }),
    } as unknown as ConfigService;

    return new StellarService(config);
  }

  /** A Horizon account response is an Account plus the balance rows. */
  function accountWith(publicKey: string, balances: unknown[]) {
    return Object.assign(new Account(publicKey, '1'), { balances });
  }

  function trustline(
    code: string,
    issuer: string,
    balance: string,
    buyingLiabilities = '0.0000000',
  ) {
    return {
      asset_type: 'credit_alphanum4',
      asset_code: code,
      asset_issuer: issuer,
      balance,
      buying_liabilities: buyingLiabilities,
      selling_liabilities: '0.0000000',
    };
  }

  const nativeBalance = { asset_type: 'native', balance: '0.0000000' };

  function stubHorizon(service: StellarService, userBalances: unknown[]) {
    const server = (service as unknown as { server: { loadAccount: unknown } })
      .server;
    server.loadAccount = jest.fn((address: string) =>
      Promise.resolve(
        address === treasury.publicKey()
          ? accountWith(treasury.publicKey(), [])
          : accountWith(user.publicKey(), userBalances),
      ),
    );
  }

  function operationsOf(xdr: string) {
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;
    return tx.operations;
  }

  it('sweeps the balance before removing the trustline, and merges last', async () => {
    const service = createService();
    stubHorizon(service, [
      nativeBalance,
      trustline('USDC', usdcIssuer, '0.0030000'),
    ]);

    const { xdr } = await service.buildAccountClosureXdr(user.publicKey());
    const types = operationsOf(xdr).map((op) => op.type);

    expect(types).toEqual(['payment', 'changeTrust', 'accountMerge']);
  });

  it('omits the payment when the trustline is already empty', async () => {
    const service = createService();
    stubHorizon(service, [
      nativeBalance,
      trustline('USDC', usdcIssuer, '0.0000000'),
    ]);

    const { xdr } = await service.buildAccountClosureXdr(user.publicKey());
    const types = operationsOf(xdr).map((op) => op.type);

    expect(types).toEqual(['changeTrust', 'accountMerge']);
  });

  it('reports the swept amount read from Horizon', async () => {
    const service = createService();
    stubHorizon(service, [
      nativeBalance,
      trustline('USDC', usdcIssuer, '0.0030000'),
    ]);

    const result = await service.buildAccountClosureXdr(user.publicKey());

    expect(result.sweptAmount.toString()).toBe('0.003');
    expect(result.sweptAssetSymbol).toBe('USDC');
  });

  it('reports no swept asset when nothing was swept', async () => {
    const service = createService();
    stubHorizon(service, [
      nativeBalance,
      trustline('USDC', usdcIssuer, '0.0000000'),
    ]);

    const result = await service.buildAccountClosureXdr(user.publicKey());

    expect(result.sweptAmount.toString()).toBe('0');
    expect(result.sweptAssetSymbol).toBeNull();
  });

  it('closes both trustlines when the secondary asset is configured', async () => {
    const service = createService({ tesouro: true });
    stubHorizon(service, [
      nativeBalance,
      trustline('USDC', usdcIssuer, '0.0030000'),
      trustline('TESOURO', tesouroIssuer, '0.0010000'),
    ]);

    const { xdr } = await service.buildAccountClosureXdr(user.publicKey());
    const types = operationsOf(xdr).map((op) => op.type);

    expect(types).toEqual([
      'payment',
      'payment',
      'changeTrust',
      'changeTrust',
      'accountMerge',
    ]);
  });

  it('ignores the secondary asset when it is not configured', async () => {
    const service = createService({ tesouro: false });
    stubHorizon(service, [
      nativeBalance,
      trustline('USDC', usdcIssuer, '0.0000000'),
      trustline('TESOURO', tesouroIssuer, '5.0000000'),
    ]);

    const { xdr } = await service.buildAccountClosureXdr(user.publicKey());
    const types = operationsOf(xdr).map((op) => op.type);

    expect(types).toEqual(['changeTrust', 'accountMerge']);
  });

  it('skips an asset the account never trusted', async () => {
    const service = createService({ tesouro: true });
    stubHorizon(service, [
      nativeBalance,
      trustline('USDC', usdcIssuer, '0.0000000'),
    ]);

    const { xdr } = await service.buildAccountClosureXdr(user.publicKey());
    const types = operationsOf(xdr).map((op) => op.type);

    expect(types).toEqual(['changeTrust', 'accountMerge']);
  });

  it('refuses to build when an open offer is buying the asset', async () => {
    const service = createService();
    stubHorizon(service, [
      nativeBalance,
      trustline('USDC', usdcIssuer, '0.0000000', '10.0000000'),
    ]);

    await expect(
      service.buildAccountClosureXdr(user.publicKey()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('leaves the fee at zero so the Treasury FeeBump covers it', async () => {
    const service = createService();
    stubHorizon(service, [
      nativeBalance,
      trustline('USDC', usdcIssuer, '0.0030000'),
    ]);

    const { xdr } = await service.buildAccountClosureXdr(user.publicKey());
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;

    expect(tx.fee).toBe('0');
  });
});

describe('StellarService closure error translation', () => {
  const treasury = Keypair.random();
  const values: Record<string, string | number> = {
    DEFINDEX_NETWORK: 'testnet',
    STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    STELLAR_USDC_ASSET_CODE: 'USDC',
    STELLAR_USDC_ISSUER: Keypair.random().publicKey(),
    STELLAR_FEE_BUMP_BASE_FEE: 500,
    TREASURY_STELLAR_SECRET: treasury.secret(),
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
    ),
    getOrThrow: jest.fn((key: string) => {
      if (!(key in values)) throw new Error(`Missing ${key}`);
      return values[key];
    }),
  } as unknown as ConfigService;

  async function submitAndCatch(operationCode: string) {
    const service = new StellarService(config);
    const server = (
      service as unknown as {
        server: { feeStats: unknown; submitTransaction: unknown };
      }
    ).server;
    server.feeStats = jest.fn().mockResolvedValue({
      fee_charged: { p90: '200' },
    });
    server.submitTransaction = jest.fn().mockRejectedValue({
      response: {
        data: { extras: { result_codes: { operations: [operationCode] } } },
      },
    });

    const inner = new TransactionBuilder(
      new Account(treasury.publicKey(), '1'),
      { fee: '0', networkPassphrase: Networks.TESTNET },
    )
      .addOperation(Operation.manageData({ name: 'x', value: 'y' }))
      .setTimeout(60)
      .build();
    inner.sign(treasury);

    try {
      await service.submitFeeBumpTransaction(
        inner.toEnvelope().toXDR('base64'),
      );
      throw new Error('expected submission to fail');
    } catch (err) {
      return (err as Error).message;
    }
  }

  // The raw codes are the ones a closure can realistically hit. Left untranslated,
  // the user sees "op_cannot_delete" and has no idea what to do about it.
  it.each([
    ['op_cannot_delete', 'ordens abertas'],
    ['op_invalid_limit', 'varrer o saldo'],
    ['op_has_sub_entries', 'linhas de confiança'],
    ['op_is_sponsor', 'patrocina reservas'],
    ['op_dest_full', 'tesouraria'],
  ])('translates %s into something actionable', async (code, expected) => {
    const message = await submitAndCatch(code);

    expect(message).toContain(expected);
    expect(message).not.toContain(code);
  });
});
