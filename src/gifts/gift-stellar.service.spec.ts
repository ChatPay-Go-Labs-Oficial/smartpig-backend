import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  Account,
  BASE_FEE,
  Keypair,
  Networks,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { GiftStellarService } from './gift-stellar.service';

const AGENT = Keypair.random();
const RECIPIENT = Keypair.random().publicKey();
const USDC_ISSUER = Keypair.random().publicKey();
const HORIZON = 'https://horizon.test';
const USDC_ID = `USDC:${USDC_ISSUER}`;
/** Claimable balance ids are 72 hex characters; the SDK rejects anything else. */
const BALANCE_ID = `00000000${'a'.repeat(64)}`;

interface Options {
  omitSecret?: boolean;
  records?: { id: string; asset: string; amount: string; sponsor?: string }[];
}

function createService(options: Options = {}) {
  const { omitSecret = false, records = [] } = options;

  const values: Record<string, string | undefined> = {
    // Trailing slash on purpose: the service strips it, and without that every
    // Horizon URL it builds would carry a double slash.
    STELLAR_HORIZON_URL: `${HORIZON}/`,
    STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
    STELLAR_USDC_ASSET_CODE: 'USDC',
    STELLAR_USDC_ISSUER: USDC_ISSUER,
    GIFT_CLAIM_AGENT_SECRET: omitSecret ? undefined : AGENT.secret(),
  };

  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;

  const service = new GiftStellarService(config);

  const call = jest.fn().mockResolvedValue({ records });
  const balancesBuilder = {
    claimant: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call,
  };
  const loadAccount = jest
    .fn()
    .mockResolvedValue(new Account(AGENT.publicKey(), '1'));

  // Horizon is reached two ways here: the SDK's own client for reads, and bare
  // axios for the writes. Both are replaced.
  (
    service as unknown as {
      server: { loadAccount: unknown; claimableBalances: unknown };
    }
  ).server = {
    loadAccount,
    claimableBalances: jest.fn().mockReturnValue(balancesBuilder),
  };

  return { service, loadAccount, balancesBuilder };
}

/** Shaped like the axios error the service inspects. */
function horizonError(status: number, data?: unknown) {
  return { isAxiosError: true, response: { status, data } };
}

describe('GiftStellarService', () => {
  let get: jest.SpyInstance;
  let post: jest.SpyInstance;

  beforeEach(() => {
    get = jest.spyOn(axios, 'get');
    post = jest.spyOn(axios, 'post');
  });

  afterEach(() => jest.restoreAllMocks());

  describe('the claim agent', () => {
    it('reports itself unconfigured when the secret is absent', () => {
      // Every job that touches gifts skips its work on this answer.
      const { service } = createService({ omitSecret: true });

      expect(service.isConfigured()).toBe(false);
    });

    it('refuses to hand out a public key it does not have', () => {
      const { service } = createService({ omitSecret: true });

      expect(() => service.getAgentPublicKey()).toThrow(
        ServiceUnavailableException,
      );
    });

    it('derives the agent public key from the configured secret', () => {
      const { service } = createService();

      expect(service.isConfigured()).toBe(true);
      expect(service.getAgentPublicKey()).toBe(AGENT.publicKey());
    });
  });

  describe('listAgentClaimableBalances', () => {
    it('returns only balances of the configured USDC asset', async () => {
      // The agent can be named claimant on anything; paying out a gift from a
      // balance of another asset would send the wrong token.
      const { service } = createService({
        records: [
          { id: 'bal-usdc', asset: USDC_ID, amount: '10', sponsor: 'GSPONSOR' },
          { id: 'bal-xlm', asset: 'native', amount: '5' },
        ],
      });

      const balances = await service.listAgentClaimableBalances();

      expect(balances).toEqual([
        { balanceId: 'bal-usdc', amount: '10', sponsor: 'GSPONSOR' },
      ]);
    });

    it('reports a missing sponsor as null rather than undefined', async () => {
      const { service } = createService({
        records: [{ id: 'bal-usdc', asset: USDC_ID, amount: '10' }],
      });

      const [balance] = await service.listAgentClaimableBalances();

      expect(balance.sponsor).toBeNull();
    });

    it('asks Horizon for the balances the agent can claim', async () => {
      const { service, balancesBuilder } = createService();

      await service.listAgentClaimableBalances();

      expect(balancesBuilder.claimant).toHaveBeenCalledWith(AGENT.publicKey());
    });
  });

  describe('getBalanceFundingTx', () => {
    it('returns the first transaction, which carries the gift memo', async () => {
      const { service } = createService();
      get.mockResolvedValue({
        data: { _embedded: { records: [{ hash: 'tx-1', memo: 'GIFT-ABC' }] } },
      });

      await expect(service.getBalanceFundingTx('bal-1')).resolves.toEqual({
        hash: 'tx-1',
        memo: 'GIFT-ABC',
      });

      expect(get).toHaveBeenCalledWith(
        `${HORIZON}/claimable_balances/bal-1/transactions`,
        expect.objectContaining({ params: { limit: 1, order: 'asc' } }),
      );
    });

    it('reports a transaction without a memo as null', async () => {
      // A memo-less funding transaction cannot be matched to a gift, and the
      // job must be able to tell that apart from a missing field.
      const { service } = createService();
      get.mockResolvedValue({
        data: { _embedded: { records: [{ hash: 'tx-1' }] } },
      });

      await expect(service.getBalanceFundingTx('bal-1')).resolves.toEqual({
        hash: 'tx-1',
        memo: null,
      });
    });

    it('returns null when Horizon lists no transaction at all', async () => {
      const { service } = createService();
      get.mockResolvedValue({ data: { _embedded: { records: [] } } });

      await expect(service.getBalanceFundingTx('bal-1')).resolves.toBeNull();
    });

    it('returns null when the response carries no records field', async () => {
      const { service } = createService();
      get.mockResolvedValue({ data: {} });

      await expect(service.getBalanceFundingTx('bal-1')).resolves.toBeNull();
    });
  });

  describe('balanceExists', () => {
    it('is true while Horizon still serves the balance', async () => {
      const { service } = createService();
      get.mockResolvedValue({ data: { id: 'bal-1' } });

      await expect(service.balanceExists('bal-1')).resolves.toBe(true);
    });

    it('is false on 404, which is how a claim or refund shows up', async () => {
      const { service } = createService();
      get.mockRejectedValue(horizonError(404));

      await expect(service.balanceExists('bal-1')).resolves.toBe(false);
    });

    it('is false on a 404 that did not come from axios', async () => {
      // The refund sweep reads this answer to mark a gift REFUNDED, so the
      // status has to be found whatever shape the thrown error has.
      const { service } = createService();
      get.mockRejectedValue({ response: { status: 404 } });

      await expect(service.balanceExists('bal-1')).resolves.toBe(false);
    });

    it('propagates anything that is not a 404', async () => {
      // Reading a 500 as "the balance is gone" would mark a live gift refunded.
      const { service } = createService();
      get.mockRejectedValue(horizonError(500));

      await expect(service.balanceExists('bal-1')).rejects.toBeDefined();
    });

    it('propagates a failure that never reached Horizon', async () => {
      const { service } = createService();
      get.mockRejectedValue(new Error('ECONNRESET'));

      await expect(service.balanceExists('bal-1')).rejects.toThrow(
        'ECONNRESET',
      );
    });
  });

  describe('claimAndPay', () => {
    function submittedTransaction() {
      const body = post.mock.calls[0][1] as string;
      const xdr = new URLSearchParams(body).get('tx') ?? '';
      return TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    }

    it('claims and pays in one transaction, so the agent never holds funds', async () => {
      const { service } = createService();
      post.mockResolvedValue({ data: { hash: 'tx-hash' } });

      await expect(
        service.claimAndPay(BALANCE_ID, RECIPIENT, '10'),
      ).resolves.toEqual({ hash: 'tx-hash' });

      const tx = submittedTransaction();
      expect(tx.operations.map((op) => op.type)).toEqual([
        'claimClaimableBalance',
        'payment',
      ]);
    });

    it('pays the recipient the configured USDC, not the native asset', async () => {
      const { service } = createService();
      post.mockResolvedValue({ data: { hash: 'tx-hash' } });

      await service.claimAndPay(BALANCE_ID, RECIPIENT, '10');

      const payment = submittedTransaction().operations[1];
      expect(payment).toMatchObject({
        type: 'payment',
        destination: RECIPIENT,
        // Stellar carries seven decimals, which is what the built operation
        // holds whatever scale the caller passed.
        amount: '10.0000000',
        asset: expect.objectContaining({ code: 'USDC', issuer: USDC_ISSUER }),
      });
    });

    it('signs with the claim agent, the only listed claimant', async () => {
      const { service } = createService();
      post.mockResolvedValue({ data: { hash: 'tx-hash' } });

      await service.claimAndPay(BALANCE_ID, RECIPIENT, '10');

      const tx = submittedTransaction();
      expect(tx.signatures).toHaveLength(1);
      expect(AGENT.verify(tx.hash(), tx.signatures[0].signature())).toBe(true);
    });

    it('carries fee headroom over the base fee for its two operations', async () => {
      // A gift claim stuck in the queue under surge pricing is a payout the
      // recipient is already waiting on.
      const { service } = createService();
      post.mockResolvedValue({ data: { hash: 'tx-hash' } });

      await service.claimAndPay(BALANCE_ID, RECIPIENT, '10');

      expect(submittedTransaction().fee).toBe(String(Number(BASE_FEE) * 4 * 2));
    });

    it('fails loudly when Horizon answers without a transaction hash', async () => {
      // Returning silently would let the caller record a payout with no
      // transaction behind it.
      const { service } = createService();
      post.mockResolvedValue({ data: {} });

      await expect(
        service.claimAndPay(BALANCE_ID, RECIPIENT, '10'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    describe('when Horizon rejects the transaction', () => {
      it('reports the transaction result code', async () => {
        const { service } = createService();
        post.mockRejectedValue(
          horizonError(400, {
            extras: { result_codes: { transaction: 'tx_bad_seq' } },
          }),
        );

        await expect(
          service.claimAndPay(BALANCE_ID, RECIPIENT, '10'),
        ).rejects.toThrow(/tx_bad_seq/);
      });

      it('reports the operation codes, which say which leg failed', async () => {
        const { service } = createService();
        post.mockRejectedValue(
          horizonError(400, {
            extras: {
              result_codes: {
                transaction: 'tx_failed',
                operations: ['op_no_trust', 'op_underfunded'],
              },
            },
          }),
        );

        await expect(
          service.claimAndPay(BALANCE_ID, RECIPIENT, '10'),
        ).rejects.toThrow(/tx_failed op_no_trust,op_underfunded/);
      });

      it('falls back to the error message when Horizon sent no codes', async () => {
        const { service } = createService();
        post.mockRejectedValue(new Error('socket hang up'));

        await expect(
          service.claimAndPay(BALANCE_ID, RECIPIENT, '10'),
        ).rejects.toThrow(/socket hang up/);
      });

      it('never puts a raw object in the message shown upstream', async () => {
        // Horizon can answer with a structured code; interpolating it straight
        // into the message used to read '[object Object]'.
        const { service } = createService();
        post.mockRejectedValue(
          horizonError(400, {
            extras: { result_codes: { transaction: { code: 'tx_failed' } } },
          }),
        );

        // Asserted on the caught error: `rejects.toThrow` ignores an
        // asymmetric matcher, so it would pass whatever the message said.
        const error = await service
          .claimAndPay(BALANCE_ID, RECIPIENT, '10')
          .catch((err: Error) => err);

        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as Error).message).not.toContain('[object Object]');
      });
    });
  });
});
