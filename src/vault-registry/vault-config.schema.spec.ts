import {
  assertVaultConfigRecord,
  validateVaultConfigRecord,
  type VaultConfigRecord,
} from './vault-config.schema';

/** Real mainnet identifiers, so the fixture exercises the format checks. */
const EURC_SAC = 'CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV';
const EURC_ISSUER = 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2';
const EURC_STRATEGY =
  'CC5CE6MWISDXT3MLNQ7R3FVILFVFEIH3COWGH45GJKL6BD2ZHF7F7JVI';
const XLM_SAC = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const XLM_STRATEGY = 'CDPWNUW7UMCSVO36VAJSQHQECISPJLCVPDASKHRC5SEROAAZDUQ5DG2Z';
const VAULT = 'CBP2R5KYAWJCOCVDTSNTEVL3O6JBTWOOH7SZOX7DX5DLGVZCAMLBDZM3';
const OPERATOR = 'GC5ZV3VZZEZHFU7YH6YAOEPONSTGFVRO7V64H6X2MFXRZH6QLC5OFLYP';

function eurcRecord(): VaultConfigRecord {
  return {
    vaultContractId: VAULT,
    strategies: [
      {
        contractId: EURC_STRATEGY,
        name: 'eurc_blend_autocompound_fixed',
        sourceOfYield:
          'Juros de emprestimo no pool Blend Fixed, auto-compostos',
      },
    ],
    asset: {
      symbol: 'EURC',
      code: 'EURC',
      issuer: EURC_ISSUER,
      contractId: EURC_SAC,
      decimals: 7,
      kind: 'CLASSIC',
    },
    sourceOfYield: 'Juros pagos por tomadores no pool Blend, menos as taxas',
    roles: {
      manager: OPERATOR,
      emergencyManager: OPERATOR,
      rebalanceManager: OPERATOR,
      feeReceiver: OPERATOR,
    },
    fees: { vaultFeeBps: 100, defindexFeeBps: 2000 },
    liquidity: {
      withdrawalType: 'INSTANT',
      lockupSeconds: 0,
      conditions: ['Resgate sujeito a liquidez disponivel no pool Blend'],
    },
    oracles: [
      {
        name: 'Reflector FX',
        contractId: VAULT,
        purpose: 'Converte EURC para USD na exibicao do portfolio',
      },
    ],
    dependencies: [
      { type: 'ISSUER', name: 'Circle (EURC)', identifier: EURC_ISSUER },
      { type: 'PROTOCOL', name: 'Blend', identifier: EURC_STRATEGY },
    ],
    risks: [
      { code: 'SMART_CONTRACT', severity: 'HIGH' },
      {
        code: 'FX_EXPOSURE',
        severity: 'MEDIUM',
        params: { assetCode: 'EURC' },
      },
      {
        code: 'ISSUER_CREDIT',
        severity: 'MEDIUM',
        params: { issuerName: 'Circle' },
      },
      { code: 'YIELD_NOT_GUARANTEED', severity: 'INFO' },
    ],
    provenance: {
      source: 'PIGFI_FACTORY',
      verifiedAt: '2026-10-06T00:00:00.000Z',
      verifiedBy: 'pigfi-ops',
    },
  };
}

function xlmRecord(): VaultConfigRecord {
  const base = eurcRecord();
  return {
    ...base,
    strategies: [
      {
        contractId: XLM_STRATEGY,
        name: 'xlm_blend_autocompound_fixed',
        sourceOfYield:
          'Juros de emprestimo no pool Blend Fixed, auto-compostos',
      },
    ],
    asset: {
      symbol: 'XLM',
      code: 'XLM',
      // The native asset has no issuer. DeFindex reports its symbol as "native";
      // the record is where that gets normalized to something a user can read.
      issuer: null,
      contractId: XLM_SAC,
      decimals: 7,
      kind: 'NATIVE',
    },
    dependencies: [
      { type: 'PROTOCOL', name: 'Blend', identifier: XLM_STRATEGY },
    ],
    risks: [
      { code: 'SMART_CONTRACT', severity: 'HIGH' },
      {
        code: 'PRICE_VOLATILITY',
        severity: 'HIGH',
        params: { assetCode: 'XLM' },
      },
      { code: 'YIELD_NOT_GUARANTEED', severity: 'INFO' },
    ],
  };
}

describe('validateVaultConfigRecord', () => {
  describe('the two additional vaults map cleanly', () => {
    it('accepts the EURC vault record', () => {
      expect(validateVaultConfigRecord(eurcRecord())).toEqual([]);
    });

    it('accepts the XLM vault record', () => {
      expect(validateVaultConfigRecord(xlmRecord())).toEqual([]);
    });

    it('records all ten documented facts for each vault', () => {
      // The deliverable requires each of these recorded per vault; this asserts the
      // fixtures are complete rather than merely well-typed.
      for (const record of [eurcRecord(), xlmRecord()]) {
        expect(record.vaultContractId).toBeTruthy();
        expect(record.strategies[0].contractId).toBeTruthy();
        expect(record.asset.contractId).toBeTruthy();
        expect(record.sourceOfYield).toBeTruthy();
        expect(Object.values(record.roles).every(Boolean)).toBe(true);
        expect(record.fees.vaultFeeBps).toBeGreaterThanOrEqual(0);
        expect(record.liquidity.conditions.length).toBeGreaterThan(0);
        expect(Array.isArray(record.oracles)).toBe(true);
        expect(record.dependencies.length).toBeGreaterThan(0);
        expect(record.risks.length).toBeGreaterThan(0);
      }
    });
  });

  describe('asset identity', () => {
    it('requires an issuer for a classic asset', () => {
      const record = {
        ...eurcRecord(),
        asset: { ...eurcRecord().asset, issuer: null },
      };
      expect(validateVaultConfigRecord(record)).toContain(
        'asset.issuer is required for a CLASSIC asset',
      );
    });

    it('rejects an issuer on the native asset', () => {
      const record = {
        ...xlmRecord(),
        asset: { ...xlmRecord().asset, issuer: EURC_ISSUER },
      };
      expect(validateVaultConfigRecord(record)).toContain(
        'asset.issuer must be null for NATIVE',
      );
    });

    it('rejects an issuer address that is not a Stellar account', () => {
      const record = {
        ...eurcRecord(),
        asset: { ...eurcRecord().asset, issuer: 'not-an-address' },
      };
      expect(validateVaultConfigRecord(record).join()).toContain(
        'asset.issuer is not a Stellar account id',
      );
    });

    it('rejects a SAC id that is actually an account id', () => {
      // Easy mistake: VaultAssetDto.address is a contract id, not the G… issuer.
      const record = {
        ...eurcRecord(),
        asset: { ...eurcRecord().asset, contractId: EURC_ISSUER },
      };
      expect(validateVaultConfigRecord(record).join()).toContain(
        'asset.contractId is not a contract id',
      );
    });
  });

  describe('fees and roles', () => {
    it('rejects a fee above 100%', () => {
      const record = {
        ...eurcRecord(),
        fees: { vaultFeeBps: 10_001, defindexFeeBps: 2000 },
      };
      expect(validateVaultConfigRecord(record).join()).toContain(
        'fees.vaultFeeBps exceeds 100%',
      );
    });

    it('accepts the 2000 bps fee the third-party vaults actually charge', () => {
      const record = {
        ...eurcRecord(),
        fees: { vaultFeeBps: 2000, defindexFeeBps: 5000 },
      };
      expect(validateVaultConfigRecord(record)).toEqual([]);
    });

    it('requires every privileged role to be named', () => {
      const roles = { ...eurcRecord().roles, emergencyManager: '' };
      expect(validateVaultConfigRecord({ ...eurcRecord(), roles })).toContain(
        'roles.emergencyManager is required',
      );
    });
  });

  describe('liquidity', () => {
    it('requires a lockup when withdrawal is delayed', () => {
      const record = {
        ...eurcRecord(),
        liquidity: {
          withdrawalType: 'DELAYED' as const,
          lockupSeconds: 0,
          conditions: ['x'],
        },
      };
      expect(validateVaultConfigRecord(record)).toContain(
        'liquidity.lockupSeconds must be set when withdrawalType is DELAYED',
      );
    });

    it('requires at least one stated condition', () => {
      const record = {
        ...eurcRecord(),
        liquidity: { ...eurcRecord().liquidity, conditions: [] },
      };
      expect(validateVaultConfigRecord(record).join()).toContain(
        'liquidity.conditions must list at least one',
      );
    });
  });

  describe('risks', () => {
    it('rejects an unknown risk code', () => {
      const record = {
        ...eurcRecord(),
        risks: [{ code: 'MADE_UP', severity: 'HIGH' }],
      };
      expect(validateVaultConfigRecord(record).join()).toContain(
        'is not a known RiskCode',
      );
    });

    it('rejects a duplicated risk code', () => {
      const record = {
        ...eurcRecord(),
        risks: [
          { code: 'SMART_CONTRACT' as const, severity: 'HIGH' as const },
          { code: 'SMART_CONTRACT' as const, severity: 'INFO' as const },
        ],
      };
      expect(validateVaultConfigRecord(record).join()).toContain(
        'code is duplicated: SMART_CONTRACT',
      );
    });

    it('requires a fallback to cover both Lite and Pro', () => {
      const record = {
        ...eurcRecord(),
        risks: [
          {
            code: 'DEPEG' as const,
            severity: 'MEDIUM' as const,
            fallbackText: { lite: 'so lite', pro: '' },
          },
        ],
      };
      expect(validateVaultConfigRecord(record).join()).toContain(
        'needs both lite and pro wording',
      );
    });

    it('requires at least one declared risk', () => {
      expect(
        validateVaultConfigRecord({ ...eurcRecord(), risks: [] }),
      ).toContain('risks must declare at least one risk');
    });
  });

  describe('provenance separates PigFi engineering from DeFindex configuration', () => {
    it('rejects an unknown source', () => {
      const record = {
        ...eurcRecord(),
        provenance: { ...eurcRecord().provenance, source: 'SOMEWHERE' },
      };
      expect(validateVaultConfigRecord(record).join()).toContain(
        'provenance.source must be',
      );
    });

    it('rejects an unparseable verifiedAt', () => {
      const record = {
        ...eurcRecord(),
        provenance: { ...eurcRecord().provenance, verifiedAt: 'last tuesday' },
      };
      expect(validateVaultConfigRecord(record).join()).toContain(
        'provenance.verifiedAt is not a date',
      );
    });
  });

  describe('shape', () => {
    it('reports every problem at once rather than stopping at the first', () => {
      const errors = validateVaultConfigRecord({});
      expect(errors.length).toBeGreaterThan(5);
    });

    it.each([null, undefined, 'a string', 42, []])(
      'rejects %p as a record',
      (input) => {
        expect(validateVaultConfigRecord(input)).toEqual([
          'configRecord must be an object',
        ]);
      },
    );
  });

  describe('assertVaultConfigRecord', () => {
    it('returns the record when valid', () => {
      expect(assertVaultConfigRecord(eurcRecord()).asset.symbol).toBe('EURC');
    });

    it('throws listing the problems, so a bad seed is fixable in one pass', () => {
      expect(() => assertVaultConfigRecord({}, 'eurc-vault')).toThrow(
        /eurc-vault is invalid:/,
      );
    });
  });
});
