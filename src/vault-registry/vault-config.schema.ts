import { isRiskCode, isRiskSeverity, type RiskEntry } from './types/risk-codes';

/** How the vault instance came to exist. Required evidence for the grant. */
export type VaultProvenanceSource = 'DEFINDEX_SUPPLIED' | 'PIGFI_FACTORY';

export type AssetKind = 'NATIVE' | 'CLASSIC';

export type WithdrawalType = 'INSTANT' | 'DELAYED';

export type DependencyType =
  | 'ISSUER'
  | 'POOL'
  | 'BACKSTOP'
  | 'PROTOCOL'
  | 'AMM';

export interface ConfigStrategy {
  contractId: string;
  name: string;
  /** Where the yield actually comes from, in plain language. */
  sourceOfYield: string;
  paused?: boolean;
}

export interface ConfigAsset {
  symbol: string;
  /** Stellar asset code. For the native asset this is `XLM`. */
  code: string;
  /** `null` for the native asset, which has no issuer. */
  issuer: string | null;
  /** Stellar Asset Contract id (C…), which is what DeFindex addresses. */
  contractId: string;
  decimals: number;
  kind: AssetKind;
}

export interface ConfigRoles {
  manager: string;
  emergencyManager: string;
  rebalanceManager: string;
  feeReceiver: string;
}

export interface ConfigFees {
  vaultFeeBps: number;
  defindexFeeBps: number;
}

export interface ConfigLiquidity {
  withdrawalType: WithdrawalType;
  lockupSeconds: number;
  minWithdrawal?: string;
  /** Conditions a user should know before depositing, one per entry. */
  conditions: string[];
}

export interface ConfigOracle {
  name: string;
  contractId: string;
  purpose: string;
}

export interface ConfigDependency {
  type: DependencyType;
  name: string;
  /** Contract id, issuer address, or another stable identifier. */
  identifier: string;
}

export interface ConfigProvenance {
  source: VaultProvenanceSource;
  /** ISO 8601. When the configuration was last checked against chain. */
  verifiedAt: string;
  verifiedBy: string;
}

/**
 * The per-vault configuration record.
 *
 * This is the single source for the ten facts the deliverable requires recorded for
 * each vault: vault contract id, strategy contract id, asset and asset identifier,
 * strategy and source of yield, roles/fees/parameters, liquidity and withdrawal
 * conditions, oracle or pricing dependencies, issuer/pool/backstop/protocol
 * dependencies, and the principal risks in plain language.
 *
 * It is authored once in the seed and consumed twice — it populates the row the API
 * serves and it renders the markdown a reviewer reads — so the two cannot drift.
 */
export interface VaultConfigRecord {
  vaultContractId: string;
  strategies: ConfigStrategy[];
  asset: ConfigAsset;
  sourceOfYield: string;
  roles: ConfigRoles;
  fees: ConfigFees;
  liquidity: ConfigLiquidity;
  oracles: ConfigOracle[];
  dependencies: ConfigDependency[];
  risks: RiskEntry[];
  provenance: ConfigProvenance;
}

const STELLAR_ACCOUNT = /^G[A-Z2-7]{55}$/;
const STELLAR_CONTRACT = /^C[A-Z2-7]{55}$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Validates a config record and returns every problem found.
 *
 * Collects rather than throws on the first error: this runs over a hand-authored
 * seed, and fixing ten complaints in one pass beats ten runs. An empty array means
 * the record satisfies the documentation requirement.
 */
export function validateVaultConfigRecord(input: unknown): string[] {
  const errors: string[] = [];
  const fail = (msg: string) => errors.push(msg);

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return ['configRecord must be an object'];
  }
  const r = input as Partial<VaultConfigRecord>;

  // 1 — vault contract id
  if (!isNonEmptyString(r.vaultContractId)) {
    fail('vaultContractId is required');
  } else if (!STELLAR_CONTRACT.test(r.vaultContractId)) {
    fail(`vaultContractId is not a Stellar contract id: ${r.vaultContractId}`);
  }

  // 2 — strategy contract ids and source of yield
  if (!Array.isArray(r.strategies) || r.strategies.length === 0) {
    fail('strategies must list at least one strategy');
  } else {
    r.strategies.forEach((s, i) => {
      if (!isNonEmptyString(s?.contractId)) {
        fail(`strategies[${i}].contractId is required`);
      } else if (!STELLAR_CONTRACT.test(s.contractId)) {
        fail(
          `strategies[${i}].contractId is not a contract id: ${s.contractId}`,
        );
      }
      if (!isNonEmptyString(s?.name)) fail(`strategies[${i}].name is required`);
      if (!isNonEmptyString(s?.sourceOfYield)) {
        fail(`strategies[${i}].sourceOfYield is required`);
      }
    });
  }

  // 3 — asset and asset identifier
  const asset = r.asset;
  if (!asset || typeof asset !== 'object') {
    fail('asset is required');
  } else {
    if (!isNonEmptyString(asset.symbol)) fail('asset.symbol is required');
    if (!isNonEmptyString(asset.code)) fail('asset.code is required');
    if (asset.kind !== 'NATIVE' && asset.kind !== 'CLASSIC') {
      fail('asset.kind must be NATIVE or CLASSIC');
    }
    // The native asset has no issuer; a classic one must have a real account id.
    if (asset.kind === 'NATIVE') {
      if (asset.issuer !== null) fail('asset.issuer must be null for NATIVE');
    } else if (!isNonEmptyString(asset.issuer)) {
      fail('asset.issuer is required for a CLASSIC asset');
    } else if (!STELLAR_ACCOUNT.test(asset.issuer)) {
      fail(`asset.issuer is not a Stellar account id: ${asset.issuer}`);
    }
    if (!isNonEmptyString(asset.contractId)) {
      fail('asset.contractId (SAC) is required');
    } else if (!STELLAR_CONTRACT.test(asset.contractId)) {
      fail(`asset.contractId is not a contract id: ${asset.contractId}`);
    }
    if (!Number.isInteger(asset.decimals) || asset.decimals < 0) {
      fail('asset.decimals must be a non-negative integer');
    }
  }

  // 4 — source of yield
  if (!isNonEmptyString(r.sourceOfYield)) fail('sourceOfYield is required');

  // 5 — roles and fees
  const roles = r.roles;
  if (!roles || typeof roles !== 'object') {
    fail('roles is required');
  } else {
    (
      [
        'manager',
        'emergencyManager',
        'rebalanceManager',
        'feeReceiver',
      ] as const
    ).forEach((role) => {
      const value = roles[role];
      if (!isNonEmptyString(value)) {
        fail(`roles.${role} is required`);
      } else if (!STELLAR_ACCOUNT.test(value)) {
        fail(`roles.${role} is not a Stellar account id: ${value}`);
      }
    });
  }

  const fees = r.fees;
  if (!fees || typeof fees !== 'object') {
    fail('fees is required');
  } else {
    (['vaultFeeBps', 'defindexFeeBps'] as const).forEach((key) => {
      const value = fees[key];
      if (!Number.isInteger(value) || value < 0) {
        fail(`fees.${key} must be a non-negative integer in basis points`);
      } else if (value > 10_000) {
        fail(`fees.${key} exceeds 100% (${value} bps)`);
      }
    });
  }

  // 6 — liquidity and withdrawal conditions
  const liquidity = r.liquidity;
  if (!liquidity || typeof liquidity !== 'object') {
    fail('liquidity is required');
  } else {
    if (
      liquidity.withdrawalType !== 'INSTANT' &&
      liquidity.withdrawalType !== 'DELAYED'
    ) {
      fail('liquidity.withdrawalType must be INSTANT or DELAYED');
    }
    if (!isFiniteNonNegative(liquidity.lockupSeconds)) {
      fail('liquidity.lockupSeconds must be a non-negative number');
    }
    // A DELAYED withdrawal with no lockup tells the user nothing.
    if (liquidity.withdrawalType === 'DELAYED' && !liquidity.lockupSeconds) {
      fail(
        'liquidity.lockupSeconds must be set when withdrawalType is DELAYED',
      );
    }
    if (
      !Array.isArray(liquidity.conditions) ||
      liquidity.conditions.length === 0 ||
      !liquidity.conditions.every(isNonEmptyString)
    ) {
      fail('liquidity.conditions must list at least one non-empty condition');
    }
  }

  // 7 — oracle or pricing dependencies (may legitimately be none)
  if (!Array.isArray(r.oracles)) {
    fail('oracles must be an array (empty when there are none)');
  } else {
    r.oracles.forEach((o, i) => {
      if (!isNonEmptyString(o?.name)) fail(`oracles[${i}].name is required`);
      if (!isNonEmptyString(o?.contractId)) {
        fail(`oracles[${i}].contractId is required`);
      }
      if (!isNonEmptyString(o?.purpose))
        fail(`oracles[${i}].purpose is required`);
    });
  }

  // 8 — issuer, pool, backstop, protocol dependencies
  if (!Array.isArray(r.dependencies) || r.dependencies.length === 0) {
    fail('dependencies must list at least one dependency');
  } else {
    const allowed: DependencyType[] = [
      'ISSUER',
      'POOL',
      'BACKSTOP',
      'PROTOCOL',
      'AMM',
    ];
    r.dependencies.forEach((d, i) => {
      if (!d || !allowed.includes(d.type)) {
        fail(`dependencies[${i}].type must be one of ${allowed.join(', ')}`);
      }
      if (!isNonEmptyString(d?.name))
        fail(`dependencies[${i}].name is required`);
      if (!isNonEmptyString(d?.identifier)) {
        fail(`dependencies[${i}].identifier is required`);
      }
    });
  }

  // 9/10 — principal risks
  validateRiskEntries(r.risks).forEach(fail);

  // Provenance — which activities were PigFi engineering vs DeFindex configuration
  const provenance = r.provenance;
  if (!provenance || typeof provenance !== 'object') {
    fail('provenance is required');
  } else {
    if (
      provenance.source !== 'DEFINDEX_SUPPLIED' &&
      provenance.source !== 'PIGFI_FACTORY'
    ) {
      fail('provenance.source must be DEFINDEX_SUPPLIED or PIGFI_FACTORY');
    }
    if (!isNonEmptyString(provenance.verifiedAt)) {
      fail('provenance.verifiedAt is required');
    } else if (Number.isNaN(Date.parse(provenance.verifiedAt))) {
      fail(`provenance.verifiedAt is not a date: ${provenance.verifiedAt}`);
    }
    if (!isNonEmptyString(provenance.verifiedBy)) {
      fail('provenance.verifiedBy is required');
    }
  }

  return errors;
}

export function assertVaultConfigRecord(
  input: unknown,
  label = 'configRecord',
): VaultConfigRecord {
  const errors = validateVaultConfigRecord(input);
  if (errors.length > 0) {
    throw new Error(`${label} is invalid:\n  - ${errors.join('\n  - ')}`);
  }
  return input as VaultConfigRecord;
}

/**
 * Validates the coded risks on their own.
 *
 * Shared with the disclosure admin route: a disclosure is published independently
 * of the config record, and a typo in a code there would reach an app that renders
 * nothing for it.
 */
export function validateRiskEntries(input: unknown): string[] {
  const errors: string[] = [];

  if (!Array.isArray(input) || input.length === 0) {
    return ['risks must declare at least one risk'];
  }

  const seen = new Set<string>();
  (input as Partial<RiskEntry>[]).forEach((risk, i) => {
    if (!isRiskCode(risk?.code)) {
      errors.push(
        `risks[${i}].code is not a known RiskCode: ${String(risk?.code)}`,
      );
    } else if (seen.has(risk.code)) {
      errors.push(`risks[${i}].code is duplicated: ${risk.code}`);
    } else {
      seen.add(risk.code);
    }

    if (!isRiskSeverity(risk?.severity)) {
      errors.push(`risks[${i}].severity must be INFO, MEDIUM or HIGH`);
    }

    // A fallback is only useful if it covers both voices.
    if (risk?.fallbackText) {
      if (
        !isNonEmptyString(risk.fallbackText.lite) ||
        !isNonEmptyString(risk.fallbackText.pro)
      ) {
        errors.push(`risks[${i}].fallbackText needs both lite and pro wording`);
      }
    }
  });

  return errors;
}
