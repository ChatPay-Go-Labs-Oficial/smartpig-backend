import type { VaultFeesDto, VaultRolesDto } from './dto/defindex.dto';

/**
 * What an adapter needs to know about a vault to act on it.
 *
 * Carries `assetDecimals` because only the registry knows it, and every
 * normalization below depends on it.
 */
export interface VaultRef {
  /** Our `VaultCatalog.id`, for logging and errors. */
  id: string;
  /** The on-chain vault contract id. */
  contractId: string;
  assetSymbol: string;
  assetDecimals: number;
}

/** Protocol-agnostic vault metadata. */
export interface NormalizedVaultInfo {
  contractId: string;
  name: string;
  symbol: string;
  assetSymbol: string | null;
  /** Whole units, decimal string. Null when the protocol could not report it. */
  tvl: string | null;
  apy: number | null;
  roles: VaultRolesDto | null;
  fees: VaultFeesDto | null;
  strategies: { contractId: string; name: string; paused: boolean }[];
}

/**
 * A user's position, already in whole units.
 *
 * This is the type that ends the double-normalization bug. The client used to
 * receive raw contract units, divide by a hardcoded 1e7, and — on the vault
 * detail screen — divide the already-divided shares a second time. Only the
 * backend knows the decimals, so converting here is the only place it is correct.
 *
 * Strings, not numbers: these are balances.
 */
export interface NormalizedPosition {
  /** Vault shares in whole units. */
  shares: string;
  /** Underlying balance per vault asset, in whole units, positionally. */
  underlying: string[];
  /**
   * Raw values, preserved so the published app keeps working unchanged.
   *
   * `number | string` because that is what the API sends: DeFindex returns these
   * as JSON strings. The published client divides them by 1e7, which works for
   * either.
   */
  raw: {
    dfTokens: number | string;
    underlyingBalance: (number | string)[];
  };
}

export interface PreparedTx {
  /** Unsigned XDR for the user to authorize, or null when none was produced. */
  xdr: string | null;
}

export interface PrepareDepositRequest {
  vault: VaultRef;
  callerAddress: string;
  /** Whole units, decimal string. The adapter scales it. */
  amount: string;
  slippageBps?: number;
}

export interface PrepareWithdrawRequest {
  vault: VaultRef;
  callerAddress: string;
  /** Vault shares in whole units, decimal string. */
  shares: string;
  slippageBps?: number;
}

export interface SubmitResult {
  txHash: string;
  success: boolean;
}

/**
 * The boundary every vault operation crosses, whatever protocol is behind it.
 *
 * It exists for two reasons. The deliverable requires every vault — the original
 * one and the additional ones — to operate through one common adapter. And it is
 * the only correct home for unit normalization, which is why it is not merely a
 * pass-through: `VaultCatalog.protocol` selects the implementation, so a second
 * protocol becomes a new class rather than a branch inside the services.
 */
export interface VaultAdapter {
  /** Matches `VaultCatalog.protocol`. */
  readonly protocol: string;

  getInfo(ref: VaultRef): Promise<NormalizedVaultInfo>;
  getPosition(ref: VaultRef, account: string): Promise<NormalizedPosition>;
  getApy(ref: VaultRef): Promise<number | null>;
  prepareDeposit(req: PrepareDepositRequest): Promise<PreparedTx>;
  prepareWithdraw(req: PrepareWithdrawRequest): Promise<PreparedTx>;
  submit(signedXdr: string): Promise<SubmitResult>;
}
