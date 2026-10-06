/**
 * The risks a vault disclosure can declare.
 *
 * Mirrors the `BlockerCode` approach in `account-deletion/dto/eligibility.dto.ts`:
 * the backend ships a code plus the numbers, and the app writes the sentence. The
 * wording depends on the Lite/Pro mode the user chose and only the client knows
 * which, so display copy baked in here would be wrong for half the users.
 */
export type RiskCode =
  /** The vault and strategy contracts can hold bugs; a loss may be unrecoverable. */
  | 'SMART_CONTRACT'
  /** The yield comes from a third-party protocol with its own failure modes. */
  | 'STRATEGY_PROTOCOL'
  /** The asset is a claim on an issuer who could freeze it or fail to honour it. */
  | 'ISSUER_CREDIT'
  /** A stable asset can trade away from its peg. */
  | 'DEPEG'
  /** Holding a non-USD asset carries currency risk against the user's spend. */
  | 'FX_EXPOSURE'
  /** The asset price itself moves; the balance can fall in USD terms. */
  | 'PRICE_VOLATILITY'
  /** Withdrawal may be delayed or capped by the underlying pool's liquidity. */
  | 'LIQUIDITY_WITHDRAWAL'
  /** Converting into the vault asset executes at a market rate, with slippage. */
  | 'SLIPPAGE_CONVERSION'
  /** Valuation depends on an oracle that can be stale, wrong, or unavailable. */
  | 'ORACLE_DEPENDENCY'
  /** The advertised yield is variable and never promised. */
  | 'YIELD_NOT_GUARANTEED'
  /** Management and protocol fees reduce the realised return. */
  | 'FEES'
  /** Privileged roles can rebalance, pause strategies, or change parameters. */
  | 'ROLE_TRUST'
  /** The contract can be upgraded, changing behaviour after the deposit. */
  | 'UPGRADEABILITY'
  /** The strategy leans on a backstop module that could be exhausted. */
  | 'BACKSTOP_DEPENDENCY'
  /** No deposit insurance, no guarantee fund, no recourse. */
  | 'NO_DEPOSIT_INSURANCE';

export type RiskSeverity = 'INFO' | 'MEDIUM' | 'HIGH';

/**
 * Numbers and names the app interpolates into its own sentence. Never prose.
 *
 * Amounts and rates are strings in whole units, unformatted: the client decides
 * decimals and separators, as it already does for `BlockerParams`.
 */
export interface RiskParams {
  assetCode?: string;
  issuerName?: string;
  protocolName?: string;
  /** Combined fee in basis points, as a string so the app formats it. */
  feeBps?: string;
  vaultFeeBps?: string;
  defindexFeeBps?: string;
  lockupHours?: string;
  oracleName?: string;
  roleHolder?: string;
  slippageBps?: string;
}

/**
 * One declared risk.
 *
 * `fallbackText` is the deliberate deviation from the blockers pattern. Disclosure
 * versions must be updatable without shipping a new app build, which means the
 * backend can emit a code a published client has never seen. The app's switch stays
 * exhaustive at compile time for known codes; at runtime an unknown code renders
 * this text instead. Without it, "wording lives in the app" and "no new release"
 * could not both be true.
 */
export interface RiskEntry {
  code: RiskCode;
  severity: RiskSeverity;
  params?: RiskParams;
  fallbackText?: { lite: string; pro: string };
}

/** Plain-language sections that accompany the coded risks. */
export interface DisclosureSections {
  /** How the vault earns, in one short paragraph. */
  howItEarns?: { lite: string; pro: string };
  /** When and how money can come back out. */
  withdrawalConditions?: { lite: string; pro: string };
  /** Anything the coded risks do not cover. */
  additionalNotes?: { lite: string; pro: string };
}

export const RISK_CODES: readonly RiskCode[] = [
  'SMART_CONTRACT',
  'STRATEGY_PROTOCOL',
  'ISSUER_CREDIT',
  'DEPEG',
  'FX_EXPOSURE',
  'PRICE_VOLATILITY',
  'LIQUIDITY_WITHDRAWAL',
  'SLIPPAGE_CONVERSION',
  'ORACLE_DEPENDENCY',
  'YIELD_NOT_GUARANTEED',
  'FEES',
  'ROLE_TRUST',
  'UPGRADEABILITY',
  'BACKSTOP_DEPENDENCY',
  'NO_DEPOSIT_INSURANCE',
] as const;

export const RISK_SEVERITIES: readonly RiskSeverity[] = [
  'INFO',
  'MEDIUM',
  'HIGH',
] as const;

export function isRiskCode(value: unknown): value is RiskCode {
  return typeof value === 'string' && RISK_CODES.includes(value as RiskCode);
}

export function isRiskSeverity(value: unknown): value is RiskSeverity {
  return (
    typeof value === 'string' && RISK_SEVERITIES.includes(value as RiskSeverity)
  );
}
