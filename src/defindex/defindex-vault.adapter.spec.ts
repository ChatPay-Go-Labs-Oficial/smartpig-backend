import { DefindexVaultAdapter } from './defindex-vault.adapter';

const VAULT = {
  id: 'vault-xlm',
  contractId: 'CC22BIDKCLD3YXQG5MW4YM24FYEQKSXUQ2YLVO4X4MA2DXKY2DWOZB2E',
  assetSymbol: 'XLM',
  assetDecimals: 7,
};

function createAdapter(over: Record<string, unknown> = {}) {
  const defindex = {
    getVaultInfo: jest.fn().mockResolvedValue({
      name: 'DeFindex-Vault-PigFi XLM Vault',
      symbol: 'pXLM',
      assetSymbol: 'native',
      tvl: '483895863729',
      apy: 1.94,
      roles: {
        manager: 'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
        emergencyManager:
          'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
        rebalanceManager:
          'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
        feeReceiver: 'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
      },
      fees: { vaultFeeBps: 1002, defindexFeeBps: 5000 },
      assets: [
        {
          address: 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
          name: 'native',
          symbol: 'native',
          strategies: [
            {
              address:
                'CDPWNUW7UMCSVO36VAJSQHQECISPJLCVPDASKHRC5SEROAAZDUQ5DG2Z',
              name: 'xlm_blend_autocompound_fixed',
              paused: false,
            },
          ],
        },
      ],
    }),
    getVaultBalance: jest.fn().mockResolvedValue({
      dfTokens: 10_000_000,
      underlyingBalance: [12_500_000],
    }),
    getVaultApy: jest.fn().mockResolvedValue({ apy: 1.94 }),
    generateDepositXdr: jest.fn().mockResolvedValue({ xdr: 'AAAAdeposit' }),
    generateWithdrawXdr: jest.fn().mockResolvedValue({ xdr: 'AAAAwithdraw' }),
    submitSignedTransaction: jest
      .fn()
      .mockResolvedValue({ txHash: 'tx-1', success: true }),
    ...over,
  };

  return {
    adapter: new DefindexVaultAdapter(defindex as unknown as never),
    defindex,
  };
}

describe('DefindexVaultAdapter', () => {
  it('declares the protocol the registry dispatches on', () => {
    expect(createAdapter().adapter.protocol).toBe('DEFINDEX');
  });

  describe('getInfo', () => {
    it('keeps roles and fees, which the configuration record requires', async () => {
      const { adapter } = createAdapter();

      const info = await adapter.getInfo(VAULT);

      expect(info.roles?.manager).toMatch(/^G[A-Z2-7]{55}$/);
      expect(info.fees).toEqual({ vaultFeeBps: 1002, defindexFeeBps: 5000 });
    });

    it('normalizes TVL from raw units to whole units', async () => {
      const { adapter } = createAdapter();

      const info = await adapter.getInfo(VAULT);

      // 483895863729 raw at 7 decimals is 48,389 XLM, not 483 billion.
      expect(info.tvl).toBe('48389.5863729');
    });

    it('flattens strategies across assets', async () => {
      const { adapter } = createAdapter();

      const info = await adapter.getInfo(VAULT);

      expect(info.strategies).toEqual([
        {
          contractId:
            'CDPWNUW7UMCSVO36VAJSQHQECISPJLCVPDASKHRC5SEROAAZDUQ5DG2Z',
          name: 'xlm_blend_autocompound_fixed',
          paused: false,
        },
      ]);
    });

    it('tolerates a null TVL', async () => {
      const { adapter, defindex } = createAdapter();
      defindex.getVaultInfo.mockResolvedValue({
        name: 'x',
        symbol: 'x',
        assetSymbol: null,
        tvl: null,
        apy: 0,
        roles: null,
        fees: null,
        assets: [],
      });

      await expect(adapter.getInfo(VAULT)).resolves.toMatchObject({
        tvl: null,
        roles: null,
        fees: null,
        strategies: [],
      });
    });
  });

  describe('getPosition', () => {
    it('returns whole units, which is where the double normalization died', async () => {
      // The client used to divide raw units by a hardcoded 1e7 and, on the detail
      // screen, divide the already-divided shares a second time.
      const { adapter } = createAdapter();

      const position = await adapter.getPosition(VAULT, 'GABC');

      expect(position.shares).toBe('1.0000000');
      expect(position.underlying).toEqual(['1.2500000']);
    });

    it('preserves the raw values for the published app', async () => {
      const { adapter } = createAdapter();

      const position = await adapter.getPosition(VAULT, 'GABC');

      expect(position.raw).toEqual({
        dfTokens: 10_000_000,
        underlyingBalance: [12_500_000],
      });
    });

    it('scales shares at 7 decimals regardless of the asset', async () => {
      // Shares are always 7-decimal, even when the underlying asset is not.
      const { adapter } = createAdapter();

      const position = await adapter.getPosition(
        { ...VAULT, assetDecimals: 6 },
        'GABC',
      );

      expect(position.shares).toBe('1.0000000');
      expect(position.underlying).toEqual(['12.500000']);
    });

    it('handles an empty underlying array', async () => {
      const { adapter, defindex } = createAdapter();
      defindex.getVaultBalance.mockResolvedValue({
        dfTokens: 0,
        underlyingBalance: [],
      });

      await expect(adapter.getPosition(VAULT, 'GABC')).resolves.toMatchObject({
        shares: '0.0000000',
        underlying: [],
      });
    });
  });

  describe('prepareDeposit', () => {
    it('scales the amount by the vault asset decimals', async () => {
      const { adapter, defindex } = createAdapter();

      await adapter.prepareDeposit({
        vault: VAULT,
        callerAddress: 'GABC',
        amount: '2.5',
      });

      expect(defindex.generateDepositXdr).toHaveBeenCalledWith({
        vaultAddress: VAULT.contractId,
        callerAddress: 'GABC',
        amounts: [25_000_000],
        slippageBps: undefined,
      });
    });

    it('forwards slippage when given', async () => {
      const { adapter, defindex } = createAdapter();

      await adapter.prepareDeposit({
        vault: VAULT,
        callerAddress: 'GABC',
        amount: '1',
        slippageBps: 100,
      });

      const [args] = defindex.generateDepositXdr.mock.calls[0] as [
        { slippageBps?: number },
      ];
      expect(args.slippageBps).toBe(100);
    });

    it('rejects more decimal places than the asset supports', async () => {
      const { adapter } = createAdapter();

      await expect(
        adapter.prepareDeposit({
          vault: { ...VAULT, assetDecimals: 2 },
          callerAddress: 'GABC',
          amount: '1.555',
        }),
      ).rejects.toThrow(/at most 2 decimal places/);
    });
  });

  describe('prepareWithdraw', () => {
    it('scales shares at 7 decimals, not by the asset', async () => {
      const { adapter, defindex } = createAdapter();

      await adapter.prepareWithdraw({
        vault: { ...VAULT, assetDecimals: 2 },
        callerAddress: 'GABC',
        shares: '0.5',
      });

      expect(defindex.generateWithdrawXdr).toHaveBeenCalledWith({
        vaultAddress: VAULT.contractId,
        callerAddress: 'GABC',
        shareAmount: 5_000_000,
        slippageBps: undefined,
      });
    });
  });

  it('submit passes through the hash and the outcome', async () => {
    const { adapter } = createAdapter();

    await expect(adapter.submit('signed')).resolves.toEqual({
      txHash: 'tx-1',
      success: true,
    });
  });

  describe('an empty vault is a zero position, not an error', () => {
    it('reports zero when the vault has no supply yet', async () => {
      // DeFindex answers a balance read on a zero-supply vault with
      // VaultErrors.AmountOverTotalSupply. A brand-new vault is exactly what the
      // app hits first, since the list fans a balance read over every vault.
      const { adapter, defindex } = createAdapter();
      defindex.getVaultBalance.mockRejectedValue(
        new Error('DeFindex contract error: VaultErrors.AmountOverTotalSupply'),
      );

      await expect(adapter.getPosition(VAULT, 'GABC')).resolves.toEqual({
        shares: '0.0000000',
        underlying: [],
        raw: { dfTokens: 0, underlyingBalance: [] },
      });
    });

    it('still propagates every other failure', async () => {
      // A vault we cannot reach must not be reported as a vault the user holds
      // nothing in — that would hide a real position behind a transport error.
      const { adapter, defindex } = createAdapter();
      defindex.getVaultBalance.mockRejectedValue(new Error('ETIMEDOUT'));

      await expect(adapter.getPosition(VAULT, 'GABC')).rejects.toThrow(
        'ETIMEDOUT',
      );
    });
  });

  describe('the API sends amounts as strings', () => {
    it('normalizes a string balance without losing precision', async () => {
      // Real response from the Cofrinho PigFy vault: strings, not numbers.
      const { adapter, defindex } = createAdapter();
      defindex.getVaultBalance.mockResolvedValue({
        dfTokens: '19999000',
        underlyingBalance: ['20390279'],
      });

      await expect(adapter.getPosition(VAULT, 'GABC')).resolves.toMatchObject({
        shares: '1.9999000',
        underlying: ['2.0390279'],
      });
    });
  });
});
