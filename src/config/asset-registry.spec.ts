import {
  assetIdOf,
  findAssetBySymbol,
  readAssetRegistry,
  requireContractId,
  validateAssetRegistry,
  type AssetDefinition,
} from './asset-registry';

const ISSUER = 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2';
const SAC = 'CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV';

function asset(over: Partial<AssetDefinition> = {}): AssetDefinition {
  return {
    symbol: 'EURC',
    code: 'EURC',
    issuer: ISSUER,
    contractId: SAC,
    decimals: 7,
    kind: 'CLASSIC',
    displayPrefix: '€',
    displaySuffix: '',
    liteSymbol: 'EUR',
    liteName: 'euro',
    liteDecimals: 2,
    proDecimals: 7,
    reflectorFeed: null,
    maxSlippageBps: 50,
    isFundingAsset: true,
    ...over,
  };
}

describe('asset registry', () => {
  describe('built-in networks', () => {
    it('mainnet is valid and carries USDC, EURC and XLM', () => {
      const assets = readAssetRegistry('mainnet');
      expect(assets.map((a) => a.symbol).sort()).toEqual([
        'EURC',
        'USDC',
        'XLM',
      ]);
    });

    it('testnet is valid', () => {
      expect(() => readAssetRegistry('testnet')).not.toThrow();
    });

    it('mainnet has a verified SAC for every asset', () => {
      // Soroban paths — DeFindex deposits, Aquarius/Soroswap swaps — all need it.
      for (const a of readAssetRegistry('mainnet')) {
        expect(requireContractId(a)).toMatch(/^C[A-Z2-7]{55}$/);
      }
    });

    it('omits EURC on testnet rather than guessing an issuer', () => {
      const symbols = readAssetRegistry('testnet').map((a) => a.symbol);
      expect(symbols).not.toContain('EURC');
    });

    it('names USDC as the funding asset on both networks', () => {
      for (const network of ['mainnet', 'testnet']) {
        const funding = readAssetRegistry(network).find(
          (a) => a.isFundingAsset,
        );
        expect(funding?.symbol).toBe('USDC');
      }
    });

    it('rejects an unknown network by name', () => {
      expect(() => readAssetRegistry('futurenet')).toThrow(
        /No asset registry for network "futurenet"/,
      );
    });
  });

  describe('validation', () => {
    it('accepts a well-formed classic asset', () => {
      expect(validateAssetRegistry([asset()])).toEqual([]);
    });

    it('requires an issuer for a classic asset', () => {
      expect(validateAssetRegistry([asset({ issuer: null })]).join()).toContain(
        'issuer is required for CLASSIC',
      );
    });

    it('rejects an issuer on the native asset', () => {
      const native = asset({ symbol: 'XLM', code: 'XLM', kind: 'NATIVE' });
      expect(validateAssetRegistry([native]).join()).toContain(
        'issuer must be null for NATIVE',
      );
    });

    it('rejects a contractId that is an account id', () => {
      expect(
        validateAssetRegistry([asset({ contractId: ISSUER })]).join(),
      ).toContain('contractId is not a Stellar contract id');
    });

    it('accepts a null contractId as "not verified here"', () => {
      expect(validateAssetRegistry([asset({ contractId: null })])).toEqual([]);
    });

    it('rejects duplicated symbols', () => {
      expect(validateAssetRegistry([asset(), asset()]).join()).toContain(
        'symbol is duplicated',
      );
    });

    it('demands exactly one funding asset', () => {
      const none = [asset({ isFundingAsset: false })];
      expect(validateAssetRegistry(none).join()).toContain('found 0');

      const two = [asset(), asset({ symbol: 'USDC', code: 'USDC' })];
      expect(validateAssetRegistry(two).join()).toContain('found 2');
    });

    it('reports every problem at once', () => {
      const broken = [
        asset({ symbol: '', code: '', issuer: 'nope', decimals: -1 }),
      ];
      expect(validateAssetRegistry(broken).length).toBeGreaterThan(3);
    });

    it('rejects an empty registry', () => {
      expect(validateAssetRegistry([])).toEqual(['asset registry is empty']);
    });
  });

  describe('STELLAR_ASSETS_JSON override', () => {
    it('replaces the built-in list entirely', () => {
      const json = JSON.stringify([asset({ symbol: 'ONLY', code: 'ONLY' })]);
      expect(readAssetRegistry('mainnet', json).map((a) => a.symbol)).toEqual([
        'ONLY',
      ]);
    });

    it('is ignored when blank, falling back to the built-in list', () => {
      expect(readAssetRegistry('mainnet', '   ').length).toBe(3);
    });

    it('fails loudly on malformed JSON', () => {
      expect(() => readAssetRegistry('mainnet', '{not json')).toThrow(
        /not valid JSON/,
      );
    });

    it('requires an array', () => {
      expect(() => readAssetRegistry('mainnet', '{"symbol":"USDC"}')).toThrow(
        /must be an array/,
      );
    });

    it('validates the override instead of trusting it', () => {
      const json = JSON.stringify([asset({ isFundingAsset: false })]);
      expect(() => readAssetRegistry('mainnet', json)).toThrow(/is invalid/);
    });
  });

  describe('assetIdOf', () => {
    it('formats a classic asset as CODE:ISSUER', () => {
      expect(assetIdOf(asset())).toBe(`EURC:${ISSUER}`);
    });

    it('formats the native asset as the bare code', () => {
      // Matches what StellarService.getWalletBalances returns for native, which
      // is the bare string 'XLM' with no issuer.
      const native = asset({
        symbol: 'XLM',
        code: 'XLM',
        kind: 'NATIVE',
        issuer: null,
      });
      expect(assetIdOf(native)).toBe('XLM');
    });
  });

  describe('findAssetBySymbol', () => {
    const assets = readAssetRegistry('mainnet');

    it('finds by exact symbol', () => {
      expect(findAssetBySymbol(assets, 'EURC')?.symbol).toBe('EURC');
    });

    it('is case-insensitive and trims', () => {
      expect(findAssetBySymbol(assets, '  eurc ')?.symbol).toBe('EURC');
    });

    it('translates DeFindex\'s "native" to XLM', () => {
      // getVaultInfo and the strategies catalog both report XLM as "native";
      // keeping that translation here is what stops it leaking everywhere else.
      expect(findAssetBySymbol(assets, 'native')?.symbol).toBe('XLM');
      expect(findAssetBySymbol(assets, 'NATIVE')?.symbol).toBe('XLM');
    });

    it('returns null for an unknown symbol', () => {
      expect(findAssetBySymbol(assets, 'CETES')).toBeNull();
    });

    it.each([null, undefined, ''])('returns null for %p', (input) => {
      expect(findAssetBySymbol(assets, input)).toBeNull();
    });
  });

  describe('requireContractId', () => {
    it('returns the SAC when verified', () => {
      expect(requireContractId(asset())).toBe(SAC);
    });

    it('throws naming the asset when it is not', () => {
      expect(() => requireContractId(asset({ contractId: null }))).toThrow(
        /Asset EURC has no verified Stellar Asset Contract id/,
      );
    });
  });
});
