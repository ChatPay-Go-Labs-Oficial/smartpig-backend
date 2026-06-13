import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Account,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
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
