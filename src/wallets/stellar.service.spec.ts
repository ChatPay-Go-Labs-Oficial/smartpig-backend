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

  it('closes a trustline the configuration never mentioned', async () => {
    // This expectation is the reverse of what it used to be, because the old
    // behaviour was the bug: the closure iterated a fixed [USDC, TESOURO] list, so
    // any other trustline survived and AccountMerge then failed with
    // op_has_sub_entries — the user could not delete their account at all.
    //
    // Leaving a line holding 5.0 behind is not "ignoring an unconfigured asset",
    // it is stranding the account. The set now comes from the balances Horizon
    // reports, so an EURC line, or anything another client opened, closes too.
    const service = createService({ tesouro: false });
    stubHorizon(service, [
      nativeBalance,
      trustline('USDC', usdcIssuer, '0.0000000'),
      trustline('TESOURO', tesouroIssuer, '5.0000000'),
    ]);

    const { xdr } = await service.buildAccountClosureXdr(user.publicKey());
    const types = operationsOf(xdr).map((op) => op.type);

    expect(types).toEqual([
      'payment',
      'changeTrust',
      'changeTrust',
      'accountMerge',
    ]);
  });

  it('closes an EURC trustline, which is what the new vault opens', async () => {
    const service = createService({ tesouro: false });
    stubHorizon(service, [
      nativeBalance,
      trustline('USDC', usdcIssuer, '0.0000000'),
      trustline(
        'EURC',
        'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2',
        '1.2500000',
      ),
    ]);

    const { xdr, sweptAssets } = await service.buildAccountClosureXdr(
      user.publicKey(),
    );
    const types = operationsOf(xdr).map((op) => op.type);

    expect(types).toEqual([
      'payment',
      'changeTrust',
      'changeTrust',
      'accountMerge',
    ]);
    expect(sweptAssets).toEqual([
      {
        assetSymbol: 'EURC',
        assetId:
          'EURC:GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2',
        amount: '1.25',
      },
    ]);
  });

  it('records every sweep, since the scalar summary can only carry one', async () => {
    const service = createService({ tesouro: true });
    stubHorizon(service, [
      nativeBalance,
      trustline('USDC', usdcIssuer, '0.0030000'),
      trustline('TESOURO', tesouroIssuer, '0.0010000'),
    ]);

    const { sweptAssets, sweptAssetSymbol } =
      await service.buildAccountClosureXdr(user.publicKey());

    expect(sweptAssets.map((a) => a.assetSymbol)).toEqual(['USDC', 'TESOURO']);
    // The scalar still reports the primary asset, for the existing column.
    expect(sweptAssetSymbol).toBe('USDC');
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

describe('StellarService sponsored trustlines', () => {
  const treasury = Keypair.random();
  const user = Keypair.random();
  const EURC_ISSUER =
    'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2';

  function createService() {
    const values: Record<string, string | number> = {
      DEFINDEX_NETWORK: 'mainnet',
      STELLAR_NETWORK_PASSPHRASE: Networks.PUBLIC,
      STELLAR_HORIZON_URL: 'https://horizon.stellar.org',
      STELLAR_USDC_ASSET_CODE: 'USDC',
      STELLAR_USDC_ISSUER:
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
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
    return new StellarService(config);
  }

  function accountWith(publicKey: string, balances: unknown[]) {
    return Object.assign(new Account(publicKey, '1'), { balances });
  }

  function stubHorizon(
    service: StellarService,
    options: { userExists?: boolean; userBalances?: unknown[] } = {},
  ) {
    const { userExists = true, userBalances = [] } = options;
    const server = (service as unknown as { server: { loadAccount: unknown } })
      .server;
    server.loadAccount = jest.fn((address: string) => {
      if (address === treasury.publicKey()) {
        return Promise.resolve(accountWith(treasury.publicKey(), []));
      }
      if (!userExists) return Promise.reject(new Error('404'));
      return Promise.resolve(accountWith(user.publicKey(), userBalances));
    });
  }

  function operationsOf(xdr: string) {
    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC) as Transaction;
    return tx;
  }

  describe('the asset registry', () => {
    it('resolves a symbol, and accepts DeFindex\'s "native" for XLM', () => {
      const service = createService();

      expect(service.getAsset('EURC').code).toBe('EURC');
      expect(service.getAsset('native').symbol).toBe('XLM');
    });

    it('names USDC as the funding asset', () => {
      expect(createService().getFundingAsset().symbol).toBe('USDC');
    });

    it('rejects an asset this network does not support', () => {
      expect(() => createService().getAsset('CETES')).toThrow(
        BadRequestException,
      );
    });

    it('builds the native asset without an issuer', () => {
      const service = createService();

      const xlm = service.toStellarAsset(service.getAsset('XLM'));

      expect(xlm.isNative()).toBe(true);
    });
  });

  describe('buildSponsoredTrustlineXdr', () => {
    it('sponsors the reserve, because our wallets hold no spendable XLM', async () => {
      // The pre-existing buildUsdcTrustlineXdr builds on the user's account with
      // fee: BASE_FEE. Our wallets are created with startingBalance '0', so they
      // can pay neither the fee nor the 0.5 XLM a trustline reserves.
      const service = createService();
      stubHorizon(service);

      const xdr = await service.buildSponsoredTrustlineXdr(
        user.publicKey(),
        service.getAsset('EURC'),
      );
      const tx = operationsOf(xdr);

      expect(tx.operations.map((op) => op.type)).toEqual([
        'beginSponsoringFutureReserves',
        'changeTrust',
        'endSponsoringFutureReserves',
      ]);
      // Treasury is the transaction source with fee 0; the fee bump covers it.
      expect(tx.source).toBe(treasury.publicKey());
      expect(tx.fee).toBe('0');
    });

    it('pre-signs with the treasury, which authorizes the sponsorship', async () => {
      const service = createService();
      stubHorizon(service);

      const xdr = await service.buildSponsoredTrustlineXdr(
        user.publicKey(),
        service.getAsset('EURC'),
      );

      expect(operationsOf(xdr).signatures).toHaveLength(1);
    });

    it('sources the ChangeTrust from the user, not the treasury', async () => {
      const service = createService();
      stubHorizon(service);

      const xdr = await service.buildSponsoredTrustlineXdr(
        user.publicKey(),
        service.getAsset('EURC'),
      );
      const changeTrust = operationsOf(xdr).operations.find(
        (op) => op.type === 'changeTrust',
      );

      expect(changeTrust?.source).toBe(user.publicKey());
    });

    it('refuses the native asset, which needs no trustline', async () => {
      const service = createService();
      stubHorizon(service);

      await expect(
        service.buildSponsoredTrustlineXdr(
          user.publicKey(),
          service.getAsset('XLM'),
        ),
      ).rejects.toThrow(/native asset and needs no trustline/);
    });

    it('refuses an account that does not exist yet', async () => {
      // Activation has to come first; a trustline on a nonexistent account is not
      // a repair, it is a different failure.
      const service = createService();
      stubHorizon(service, { userExists: false });

      await expect(
        service.buildSponsoredTrustlineXdr(
          user.publicKey(),
          service.getAsset('EURC'),
        ),
      ).rejects.toThrow(/does not exist yet/);
    });
  });

  describe('hasTrustline', () => {
    it('is true when the account trusts the asset', async () => {
      const service = createService();
      stubHorizon(service, {
        userBalances: [
          {
            asset_type: 'credit_alphanum4',
            asset_code: 'EURC',
            asset_issuer: EURC_ISSUER,
            balance: '0.0000000',
          },
        ],
      });

      await expect(
        service.hasTrustline(user.publicKey(), service.getAsset('EURC')),
      ).resolves.toBe(true);
    });

    it('is false when it does not', async () => {
      const service = createService();
      stubHorizon(service, { userBalances: [] });

      await expect(
        service.hasTrustline(user.publicKey(), service.getAsset('EURC')),
      ).resolves.toBe(false);
    });

    it('is false for an account that is not on chain', async () => {
      const service = createService();
      stubHorizon(service, { userExists: false });

      await expect(
        service.hasTrustline(user.publicKey(), service.getAsset('EURC')),
      ).resolves.toBe(false);
    });

    it('is always true for the native asset', async () => {
      // XLM needs no trustline, so asking is meaningless — and it must not cost a
      // Horizon round trip either.
      const service = createService();
      stubHorizon(service, { userExists: false });

      await expect(
        service.hasTrustline(user.publicKey(), service.getAsset('XLM')),
      ).resolves.toBe(true);
    });
  });
});

describe('StellarService wallet activation', () => {
  const treasury = Keypair.random();
  const user = Keypair.random();

  function createService(options: { tesouro?: boolean } = {}) {
    const values: Record<string, string | number> = {
      DEFINDEX_NETWORK: 'mainnet',
      STELLAR_NETWORK_PASSPHRASE: Networks.PUBLIC,
      STELLAR_HORIZON_URL: 'https://horizon.stellar.org',
      STELLAR_USDC_ASSET_CODE: 'USDC',
      STELLAR_USDC_ISSUER:
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      TREASURY_STELLAR_SECRET: treasury.secret(),
    };
    if (options.tesouro) {
      values.STELLAR_TESOURO_ASSET_CODE = 'EURC';
      values.STELLAR_TESOURO_ISSUER =
        'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2';
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

  function stubHorizon(service: StellarService, userExists: boolean) {
    const server = (service as unknown as { server: { loadAccount: unknown } })
      .server;
    server.loadAccount = jest.fn((address: string) => {
      if (address === treasury.publicKey()) {
        return Promise.resolve(
          Object.assign(new Account(treasury.publicKey(), '1'), {
            balances: [],
          }),
        );
      }
      if (!userExists) return Promise.reject(new Error('404'));
      return Promise.resolve(
        Object.assign(new Account(user.publicKey(), '1'), { balances: [] }),
      );
    });
  }

  function opsOf(xdr: string) {
    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC) as Transaction;
    return tx.operations.map((op) => op.type);
  }

  it('creates and sponsors a brand-new account', async () => {
    const service = createService();
    stubHorizon(service, false);

    const xdr = await service.buildActivationXdr(user.publicKey());

    expect(opsOf(xdr)).toEqual([
      'beginSponsoringFutureReserves',
      'createAccount',
      'changeTrust',
      'endSponsoringFutureReserves',
    ]);
  });

  it('sponsors the trustlines on an account that already exists', async () => {
    // The regression this guards: this branch used to emit a bare ChangeTrust with
    // no sponsorship. A trustline reserves 0.5 XLM and our wallets are created
    // with startingBalance '0', so it failed with op_low_reserve for exactly the
    // users it was meant to repair.
    const service = createService();
    stubHorizon(service, true);

    const xdr = await service.buildActivationXdr(user.publicKey());

    expect(opsOf(xdr)).toEqual([
      'beginSponsoringFutureReserves',
      'changeTrust',
      'endSponsoringFutureReserves',
    ]);
  });

  it('sponsors both trustlines when a secondary asset is configured', async () => {
    const service = createService({ tesouro: true });
    stubHorizon(service, true);

    const xdr = await service.buildActivationXdr(user.publicKey());

    expect(opsOf(xdr)).toEqual([
      'beginSponsoringFutureReserves',
      'changeTrust',
      'changeTrust',
      'endSponsoringFutureReserves',
    ]);
  });

  it('is pre-signed by the treasury in both branches', async () => {
    for (const exists of [true, false]) {
      const service = createService();
      stubHorizon(service, exists);

      const xdr = await service.buildActivationXdr(user.publicKey());
      const tx = TransactionBuilder.fromXDR(
        xdr,
        Networks.PUBLIC,
      ) as Transaction;

      expect(tx.signatures).toHaveLength(1);
      expect(tx.fee).toBe('0');
    }
  });
});

describe('StellarService path payment', () => {
  const treasury = Keypair.random();
  const user = Keypair.random();
  const USDC_ISSUER =
    'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
  const EURC_ISSUER =
    'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2';

  function createService() {
    const values: Record<string, string | number> = {
      DEFINDEX_NETWORK: 'mainnet',
      STELLAR_NETWORK_PASSPHRASE: Networks.PUBLIC,
      STELLAR_HORIZON_URL: 'https://horizon.stellar.org',
      STELLAR_USDC_ASSET_CODE: 'USDC',
      STELLAR_USDC_ISSUER: USDC_ISSUER,
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

    const service = new StellarService(config);
    const server = (service as unknown as { server: { loadAccount: unknown } })
      .server;
    server.loadAccount = jest.fn(() =>
      Promise.resolve(
        Object.assign(new Account(treasury.publicKey(), '1'), { balances: [] }),
      ),
    );
    return service;
  }

  async function build(service: StellarService, path: unknown[] = []) {
    const { Asset } = await import('@stellar/stellar-sdk');
    return service.buildPathPaymentXdr({
      userAddress: user.publicKey(),
      sendAsset: new Asset('USDC', USDC_ISSUER),
      sendAmount: '10.0000000',
      destAsset: new Asset('EURC', EURC_ISSUER),
      destMin: '8.9403461',
      path: path as never,
    });
  }

  function txOf(xdr: string) {
    return TransactionBuilder.fromXDR(xdr, Networks.PUBLIC) as Transaction;
  }

  it('builds a single path payment, sponsored by the treasury', async () => {
    const tx = txOf(await build(createService()));

    expect(tx.operations.map((op) => op.type)).toEqual([
      'pathPaymentStrictSend',
    ]);
    // Treasury is the source and pays nothing inside; the fee bump covers it.
    expect(tx.source).toBe(treasury.publicKey());
    expect(tx.fee).toBe('0');
    expect(tx.signatures).toHaveLength(1);
  });

  it('is a self-payment: the user is both source and destination', async () => {
    // Their funding asset leaves and the target asset arrives in the same
    // operation; the counterparty is the order book, not us.
    const tx = txOf(await build(createService()));
    const op = tx.operations[0] as unknown as {
      source: string;
      destination: string;
      destMin: string;
      sendAmount: string;
    };

    expect(op.source).toBe(user.publicKey());
    expect(op.destination).toBe(user.publicKey());
  });

  it('carries destMin, which is what stops a silent bad rate', async () => {
    const tx = txOf(await build(createService()));
    const op = tx.operations[0] as unknown as {
      destMin: string;
      sendAmount: string;
    };

    expect(op.destMin).toBe('8.9403461');
    expect(op.sendAmount).toBe('10.0000000');
  });

  it('builds a direct route with an empty path', async () => {
    // What Horizon reports for USDC→EURC and USDC→XLM today.
    const tx = txOf(await build(createService(), []));
    const op = tx.operations[0] as unknown as { path: unknown[] };

    expect(op.path).toEqual([]);
  });

  it('carries a native hop through, which raw Horizon JSON would not', async () => {
    const { Asset } = await import('@stellar/stellar-sdk');
    const tx = txOf(await build(createService(), [Asset.native()]));
    const op = tx.operations[0] as unknown as {
      path: { isNative: () => boolean }[];
    };

    expect(op.path).toHaveLength(1);
    expect(op.path[0].isNative()).toBe(true);
  });
});

describe('Stellar username receiving capabilities', () => {
  it('checks the configured issuer, authorization and remaining trustline capacity', async () => {
    const service = Object.create(StellarService.prototype) as StellarService;
    Object.assign(service, {
      assetRegistry: [
        { symbol: 'USDC', code: 'USDC', issuer: 'ISSUER', kind: 'CLASSIC' },
        { symbol: 'EURC', code: 'EURC', issuer: 'EURISSUER', kind: 'CLASSIC' },
        { symbol: 'XLM', code: 'XLM', issuer: null, kind: 'NATIVE' },
      ],
      server: {
        loadAccount: jest.fn().mockResolvedValue({
          balances: [
            {
              asset_type: 'credit_alphanum4',
              asset_code: 'USDC',
              asset_issuer: 'ISSUER',
              is_authorized: true,
              balance: '0',
              buying_liabilities: '0',
              limit: '100',
            },
            {
              asset_type: 'credit_alphanum4',
              asset_code: 'EURC',
              asset_issuer: 'EURISSUER',
              is_authorized: false,
              balance: '0',
              buying_liabilities: '0',
              limit: '100',
            },
          ],
        }),
      },
    });
    await expect(service.getReceivingCapabilities('G')).resolves.toEqual({
      USDC: true,
      EURC: false,
      XLM: true,
    });
  });
});
