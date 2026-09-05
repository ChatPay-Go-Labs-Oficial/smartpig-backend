import { Decimal } from '@prisma/client/runtime/library';
import { EligibilityService } from './eligibility.service';
import { BlockerCode } from './dto/eligibility.dto';

const USDC = 'USDC:GBRTPMLQLHDHZ34UQULFUTVA5SEUNB6FDUB4IACXSDKNLZLXLMDWT4HV';
const TESOURO =
  'TESOURO:GTESOUROISSUERADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ADDRESS = `G${'A'.repeat(55)}`;
const USER = 'user-a';
const DUST = 0.01;

/** 1 stroop, the smallest amount Stellar can represent. */
const STROOP = new Decimal('0.0000001');

interface VaultRow {
  id: string;
  defindexVaultId: string;
  name: string;
  assetDecimals: number;
}

interface Options {
  wallet?: { stellarAddress: string; isActivated: boolean } | null;
  vaults?: VaultRow[];
  /** Whole-unit balance per defindexVaultId; the service receives asset units. */
  vaultBalances?: Record<string, string | Error>;
  walletBalances?: { asset: string; balance: string }[];
  gifts?: Record<string, unknown>[];
  counts?: Partial<{
    deposits: number;
    withdrawals: number;
    transactions: number;
    onramps: number;
    offramps: number;
    etherfuse: number;
  }>;
  tesouroConfigured?: boolean;
}

function createService(options: Options = {}) {
  const {
    wallet = { stellarAddress: ADDRESS, isActivated: true },
    vaults = [],
    vaultBalances = {},
    walletBalances = [],
    gifts = [],
    counts = {},
    tesouroConfigured = false,
  } = options;

  const prisma = {
    walletAccount: { findFirst: jest.fn().mockResolvedValue(wallet) },
    vaultCatalog: { findMany: jest.fn().mockResolvedValue(vaults) },
    gift: { findMany: jest.fn().mockResolvedValue(gifts) },
    depositIntent: { count: jest.fn().mockResolvedValue(counts.deposits ?? 0) },
    withdrawalIntent: {
      count: jest.fn().mockResolvedValue(counts.withdrawals ?? 0),
    },
    transactionRecord: {
      count: jest.fn().mockResolvedValue(counts.transactions ?? 0),
    },
    onrampTransaction: {
      count: jest.fn().mockResolvedValue(counts.onramps ?? 0),
    },
    offrampTransaction: {
      count: jest.fn().mockResolvedValue(counts.offramps ?? 0),
    },
    etherfuseOrder: {
      count: jest.fn().mockResolvedValue(counts.etherfuse ?? 0),
    },
  };

  const defindex = {
    getVaultBalance: jest.fn((vaultId: string) => {
      const configured = vaultBalances[vaultId];
      if (configured instanceof Error) return Promise.reject(configured);
      const vault = vaults.find((v) => v.defindexVaultId === vaultId);
      const decimals = vault?.assetDecimals ?? 7;
      const units = new Decimal(configured ?? '0')
        .mul(new Decimal(10).pow(decimals))
        .toNumber();
      return Promise.resolve({ dfTokens: units, underlyingBalance: [units] });
    }),
  };

  const stellar = {
    getWalletBalances: jest.fn().mockResolvedValue(walletBalances),
    getUsdcAssetId: jest.fn().mockReturnValue(USDC),
    getTesouroAssetId: jest
      .fn()
      .mockReturnValue(tesouroConfigured ? TESOURO : null),
  };

  const config = { get: jest.fn().mockReturnValue(DUST) };

  return {
    prisma,
    defindex,
    stellar,
    service: new EligibilityService(
      prisma as never,
      defindex as never,
      stellar as never,
      config as never,
    ),
  };
}

function vault(
  id: string,
  name = 'USDC Yield Vault',
  assetDecimals = 7,
): VaultRow {
  return { id, defindexVaultId: `def-${id}`, name, assetDecimals };
}

function codes(blockers: { code: BlockerCode }[]): BlockerCode[] {
  return blockers.map((b) => b.code);
}

describe('EligibilityService', () => {
  describe('B-1 · vault balance', () => {
    it('blocks on a vault balance above the dust threshold, naming the vault', async () => {
      const { service } = createService({
        vaults: [vault('v1', 'USDC Yield Vault')],
        vaultBalances: { 'def-v1': '42.5' },
      });

      const result = await service.check(USER);

      expect(result.eligible).toBe(false);
      const blocker = result.blockers.find((b) => b.code === 'VAULT_BALANCE');
      expect(blocker).toMatchObject({
        resolvable: true,
        action: { type: 'WITHDRAW_VAULT', vaultId: 'v1' },
        params: {
          amountUsd: '42.5',
          vaultId: 'v1',
          vaultName: 'USDC Yield Vault',
        },
      });
    });

    it('lists both vaults when two hold a balance', async () => {
      const { service } = createService({
        vaults: [vault('v1', 'Vault One'), vault('v2', 'Vault Two')],
        vaultBalances: { 'def-v1': '10', 'def-v2': '20' },
      });

      const result = await service.check(USER);

      const vaultBlockers = result.blockers.filter(
        (b) => b.code === 'VAULT_BALANCE',
      );
      expect(vaultBlockers).toHaveLength(2);
      expect(vaultBlockers.map((b) => b.action?.vaultId)).toEqual(['v1', 'v2']);
    });

    it('converts asset units to whole units before comparing', async () => {
      // 0.005 USDC arrives from DeFindex as 50000 asset units. Comparing the raw
      // number against the threshold would block an account holding half a cent.
      const { service, defindex } = createService({
        vaults: [vault('v1')],
        vaultBalances: { 'def-v1': '0.005' },
      });

      const result = await service.check(USER);

      expect(defindex.getVaultBalance).toHaveBeenCalledWith('def-v1', ADDRESS);
      expect(codes(result.blockers)).not.toContain('VAULT_BALANCE');
      expect(result.residuals.vaultShares).toEqual([
        { vaultId: 'v1', amount: '0.005' },
      ]);
    });

    it('reports the amount unrounded, leaving the formatting to the client', async () => {
      // 0.014 blocks. Rounded to two decimals it would read as the dust limit
      // itself — the same figure the consent screen uses for what gets lost. The
      // API hands over the exact number and lets the screen decide how to show it.
      const { service } = createService({
        vaults: [vault('v1')],
        vaultBalances: { 'def-v1': '0.014' },
      });

      const result = await service.check(USER);

      const blocker = result.blockers.find((b) => b.code === 'VAULT_BALANCE');
      expect(blocker?.params?.amountUsd).toBe('0.014');
    });

    it('blocks when a vault balance cannot be read, rather than assuming it is empty', async () => {
      const { service } = createService({
        vaults: [vault('v1')],
        vaultBalances: { 'def-v1': new Error('DeFindex unavailable') },
      });

      const result = await service.check(USER);

      expect(result.eligible).toBe(false);
      expect(result.blockers).toEqual([
        {
          code: 'VAULT_BALANCE_UNKNOWN',
          resolvable: false,
          action: null,
          params: { vaultId: 'v1', vaultName: 'USDC Yield Vault' },
        },
      ]);
    });
  });

  describe('B-2 and B-3 · wallet balances', () => {
    it('blocks on USDC above the dust threshold', async () => {
      const { service } = createService({
        walletBalances: [{ asset: USDC, balance: '5.0000000' }],
      });

      const result = await service.check(USER);

      expect(codes(result.blockers)).toContain('WALLET_USDC_BALANCE');
    });

    it('blocks on TESOURO above the threshold when the asset is configured', async () => {
      const { service } = createService({
        tesouroConfigured: true,
        walletBalances: [{ asset: TESOURO, balance: '3.0000000' }],
      });

      const result = await service.check(USER);

      expect(codes(result.blockers)).toContain('WALLET_ASSET_BALANCE');
    });

    it('ignores TESOURO entirely when the asset is not configured', async () => {
      const { service } = createService({
        tesouroConfigured: false,
        walletBalances: [{ asset: TESOURO, balance: '3.0000000' }],
      });

      const result = await service.check(USER);

      expect(result.eligible).toBe(true);
      expect(result.residuals.walletAssets).toEqual([]);
    });

    it('never evaluates XLM, which is sponsored reserve and not the user money', async () => {
      const { service } = createService({
        walletBalances: [{ asset: 'XLM', balance: '1.5000000' }],
      });

      const result = await service.check(USER);

      expect(result.eligible).toBe(true);
      expect(result.residuals.sweptToTreasuryUsd).toBe('0');
    });

    it('skips Horizon entirely when the wallet was never activated', async () => {
      const { service, stellar } = createService({
        wallet: { stellarAddress: ADDRESS, isActivated: false },
      });

      const result = await service.check(USER);

      expect(stellar.getWalletBalances).not.toHaveBeenCalled();
      expect(result.eligible).toBe(true);
    });
  });

  describe('B-4 and B-5 · gifts', () => {
    it('blocks without an action on a FUNDED gift, showing the release date', async () => {
      const { service } = createService({
        gifts: [
          {
            id: 'g1',
            amount: new Decimal('10'),
            status: 'FUNDED',
            balanceId: 'bal-1',
            expiresAt: new Date('2026-09-09T12:00:00.000Z'),
          },
        ],
      });

      const result = await service.check(USER);

      const blocker = result.blockers.find((b) => b.code === 'GIFT_LOCKED');
      expect(blocker).toMatchObject({
        resolvable: false,
        action: null,
        params: {
          amountUsd: '10',
          availableAt: '2026-09-09T12:00:00.000Z',
        },
      });
    });

    it('blocks on a CLAIMING gift', async () => {
      const { service } = createService({
        gifts: [
          {
            id: 'g1',
            amount: new Decimal('10'),
            status: 'CLAIMING',
            balanceId: 'bal-1',
            expiresAt: new Date('2026-09-09T12:00:00.000Z'),
          },
        ],
      });

      const result = await service.check(USER);

      expect(codes(result.blockers)).toContain('GIFT_LOCKED');
    });

    it('blocks on an EXPIRED gift that still has a balance to reclaim', async () => {
      const { service } = createService({
        gifts: [
          {
            id: 'g1',
            amount: new Decimal('10'),
            status: 'EXPIRED',
            balanceId: 'bal-1',
            expiresAt: new Date('2026-09-01T12:00:00.000Z'),
          },
        ],
      });

      const result = await service.check(USER);

      expect(
        result.blockers.find((b) => b.code === 'GIFT_REFUNDABLE'),
      ).toMatchObject({ resolvable: true, action: { type: 'OPEN_GIFTS' } });
    });

    it('does not block on an EXPIRED gift that never reached the network', async () => {
      const { service } = createService({
        gifts: [
          {
            id: 'g1',
            amount: new Decimal('10'),
            status: 'EXPIRED',
            balanceId: null,
            expiresAt: new Date('2026-09-01T12:00:00.000Z'),
          },
        ],
      });

      const result = await service.check(USER);

      expect(result.eligible).toBe(true);
    });

    it('queries only gifts the user sent, and only the three blocking states', async () => {
      const { service, prisma } = createService();

      await service.check(USER);

      expect(prisma.gift.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            senderUserId: USER,
            status: { in: ['FUNDED', 'CLAIMING', 'EXPIRED'] },
          },
        }),
      );
    });
  });

  describe('B-6 to B-11 · operations in flight', () => {
    const cases: [keyof NonNullable<Options['counts']>, BlockerCode][] = [
      ['deposits', 'DEPOSIT_IN_FLIGHT'],
      ['withdrawals', 'WITHDRAWAL_IN_FLIGHT'],
      ['transactions', 'TX_PENDING'],
      ['onramps', 'ONRAMP_IN_FLIGHT'],
      ['offramps', 'OFFRAMP_IN_FLIGHT'],
      ['etherfuse', 'ETHERFUSE_ORDER_IN_FLIGHT'],
    ];

    it.each(cases)('blocks on %s in flight', async (key, code) => {
      const { service } = createService({ counts: { [key]: 1 } });

      const result = await service.check(USER);

      expect(codes(result.blockers)).toContain(code);
      expect(result.blockers.find((b) => b.code === code)).toMatchObject({
        resolvable: false,
        action: null,
      });
    });

    it('counts only the four non-terminal intent states', async () => {
      const { service, prisma } = createService();

      await service.check(USER);

      const expected = {
        userId: USER,
        status: {
          in: ['CREATED', 'XDR_GENERATED', 'SIGNED_XDR_RECEIVED', 'SUBMITTED'],
        },
      };
      expect(prisma.depositIntent.count).toHaveBeenCalledWith({
        where: expected,
      });
      expect(prisma.withdrawalIntent.count).toHaveBeenCalledWith({
        where: expected,
      });
    });

    it('counts AWAITING_PAYMENT on the onramp — a live Pix code is the worst case', async () => {
      const { service, prisma } = createService();

      await service.check(USER);

      expect(prisma.onrampTransaction.count).toHaveBeenCalledWith({
        where: {
          userId: USER,
          status: { in: ['PENDING', 'AWAITING_PAYMENT', 'PROCESSING'] },
        },
      });
    });

    it('counts DELEGATION_NEEDED on the offramp', async () => {
      const { service, prisma } = createService();

      await service.check(USER);

      expect(prisma.offrampTransaction.count).toHaveBeenCalledWith({
        where: {
          userId: USER,
          status: { in: ['PENDING', 'DELEGATION_NEEDED', 'PROCESSING'] },
        },
      });
    });

    it('reaches Etherfuse orders through the customer, which is where userId lives', async () => {
      const { service, prisma } = createService();

      await service.check(USER);

      expect(prisma.etherfuseOrder.count).toHaveBeenCalledWith({
        where: {
          customer: { userId: USER },
          status: { in: ['CREATED', 'PENDING_SIGNATURE', 'PROCESSING'] },
        },
      });
    });
  });

  describe('dust boundaries', () => {
    it('does not block a wallet balance exactly at the threshold, and reports it as residual', async () => {
      const { service } = createService({
        walletBalances: [
          { asset: USDC, balance: new Decimal(DUST).toString() },
        ],
      });

      const result = await service.check(USER);

      expect(result.eligible).toBe(true);
      expect(result.residuals.walletUsdc).toBe('0.01');
      expect(result.residuals.sweptToTreasuryUsd).toBe('0.01');
    });

    it('blocks a wallet balance one stroop above the threshold', async () => {
      const { service } = createService({
        walletBalances: [
          { asset: USDC, balance: new Decimal(DUST).plus(STROOP).toString() },
        ],
      });

      const result = await service.check(USER);

      expect(codes(result.blockers)).toContain('WALLET_USDC_BALANCE');
    });

    it('does not block a wallet balance one stroop below the threshold', async () => {
      const { service } = createService({
        walletBalances: [
          { asset: USDC, balance: new Decimal(DUST).minus(STROOP).toString() },
        ],
      });

      const result = await service.check(USER);

      expect(result.eligible).toBe(true);
      expect(result.residuals.walletUsdc).toBe('0.0099999');
    });

    it('leaves a zero balance out of the residuals entirely', async () => {
      const { service } = createService({
        walletBalances: [{ asset: USDC, balance: '0' }],
      });

      const result = await service.check(USER);

      expect(result.eligible).toBe(true);
      expect(result.residuals.walletUsdc).toBe('0');
      expect(result.residuals.sweptToTreasuryUsd).toBe('0');
    });

    it('sums residuals in Decimal — this fails the moment someone uses parseFloat', async () => {
      // 0.009 + 0.0000001 is 0.009000099999999999 in binary floating point. The
      // exact string below is the whole point of the test: it is what the user is
      // told they will lose, and what lands in the accounting record.
      const { service } = createService({
        tesouroConfigured: true,
        walletBalances: [
          { asset: USDC, balance: '0.0090000' },
          { asset: TESOURO, balance: '0.0000001' },
        ],
      });

      const result = await service.check(USER);

      expect(result.eligible).toBe(true);
      expect(result.residuals.sweptToTreasuryUsd).toBe('0.0090001');
    });
  });

  describe('what must not block', () => {
    it('lets a fully clean account through, with no blockers', async () => {
      const { service } = createService();

      const result = await service.check(USER);

      expect(result).toMatchObject({ eligible: true, blockers: [] });
    });

    it('does not block an account without any wallet at all', async () => {
      const { service } = createService({ wallet: null });

      const result = await service.check(USER);

      expect(result.eligible).toBe(true);
    });

    it('always returns the three warnings that deletion cannot undo', async () => {
      const { service } = createService();

      const result = await service.check(USER);

      expect(result.warnings).toEqual([
        'ONCHAIN_HISTORY_PUBLIC',
        'BLINDPAY_RETAINS_KYC',
        'PRIVY_WALLET_ARCHIVED',
      ]);
    });

    it('never consults KYC state — a rejected user must still be able to leave', async () => {
      const { service, prisma } = createService();

      await service.check(USER);

      expect(Object.keys(prisma)).not.toContain('blindPayReceiver');
    });
  });

  describe('the response carries data, not copy', () => {
    it('never returns display text on a blocker', async () => {
      // The wording depends on the Lite/Pro mode the user picked — the same balance
      // is "no porquinho" for one and "no vault" for the other, and only the client
      // knows which. A sentence baked here would be wrong for half the users.
      const { service } = createService({
        vaults: [vault('v1')],
        vaultBalances: { 'def-v1': '42.5' },
        walletBalances: [{ asset: USDC, balance: '5.0000000' }],
        gifts: [
          {
            id: 'g1',
            amount: new Decimal('10'),
            status: 'FUNDED',
            balanceId: 'bal-1',
            expiresAt: new Date('2026-09-09T12:00:00.000Z'),
          },
        ],
        counts: { deposits: 1 },
      });

      const result = await service.check(USER);

      expect(result.blockers.length).toBeGreaterThan(3);
      for (const blocker of result.blockers) {
        expect(Object.keys(blocker).sort()).toEqual(
          expect.arrayContaining(['action', 'code', 'resolvable']),
        );
        for (const key of Object.keys(blocker)) {
          expect(['code', 'resolvable', 'action', 'params']).toContain(key);
        }
      }
    });
  });

  describe('residual totals', () => {
    it('separates what is swept from what is lost for good', async () => {
      const { service } = createService({
        vaults: [vault('v1')],
        vaultBalances: { 'def-v1': '0.004' },
        walletBalances: [{ asset: USDC, balance: '0.003' }],
      });

      const result = await service.check(USER);

      expect(result.eligible).toBe(true);
      expect(result.residuals.sweptToTreasuryUsd).toBe('0.003');
      expect(result.residuals.permanentlyLostUsd).toBe('0.004');
    });

    it('sums vault residuals in Decimal too', async () => {
      // Same float trap as the wallet total, on the other side of the ledger.
      const { service } = createService({
        vaults: [vault('v1', 'Vault One'), vault('v2', 'Vault Two')],
        vaultBalances: { 'def-v1': '0.009', 'def-v2': '0.0000001' },
      });

      const result = await service.check(USER);

      expect(result.eligible).toBe(true);
      expect(result.residuals.permanentlyLostUsd).toBe('0.0090001');
    });
  });
});
