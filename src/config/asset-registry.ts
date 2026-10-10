/**
 * The assets this deployment knows how to handle, per network.
 *
 * A config file and not a table, deliberately: assets are deploy-time facts that
 * differ per network, and `StellarService` needs them in its constructor. A table
 * would have to be seeded before the app could boot.
 *
 * It is still served over HTTP (`GET /app-config/assets`) so the app receives
 * symbols, prefixes and decimals without shipping a new build — the same reason
 * `/app-config/version` exists.
 */

export type AssetKind = 'NATIVE' | 'CLASSIC';

export interface ReflectorFeed {
  /** Reflector oracle contract that prices this asset. */
  contractId: string;
  /** The ticker Reflector knows it by, which is not always our symbol. */
  asset: string;
}

export interface AssetDefinition {
  /** Our canonical symbol. This is what `VaultCatalog.assetSymbol` must hold. */
  symbol: string;
  /** Stellar asset code. `XLM` for the native asset. */
  code: string;
  /** `null` for the native asset, which has no issuer. */
  issuer: string | null;
  /**
   * Stellar Asset Contract id (C…) — what DeFindex and Soroban address.
   *
   * `null` when we have not verified it for this network. Anything that needs a
   * SAC then fails with a clear message instead of silently using a wrong id.
   */
  contractId: string | null;
  decimals: number;
  kind: AssetKind;

  // ── Presentation, so a new asset needs no mobile release ──────────────
  /** Prefix in Pro mode, e.g. `$`. Empty string when the symbol does the work. */
  displayPrefix: string;
  /** Suffix, e.g. ` XLM`. */
  displaySuffix: string;
  /** How Lite mode names it — the brand voice never says "EURC". */
  liteSymbol: string;
  liteName: string;
  liteDecimals: number;
  proDecimals: number;

  /** Null when we have no price source; the portfolio then cannot value it. */
  reflectorFeed: ReflectorFeed | null;
  /** Default slippage ceiling for a conversion into this asset. */
  maxSlippageBps: number;
  /**
   * The asset the ramp delivers and balances are quoted in. Exactly one per
   * network must set this.
   */
  isFundingAsset: boolean;
}

/**
 * Reflector's external CEX/DEX oracle on mainnet.
 *
 * Verified on 2026-10-09: it quotes XLM, EURC and USDC against a USD base with 14
 * decimals and a 300-second resolution, which covers every asset here. Reflector's
 * separate FX oracle serves fiat pairs and is not needed.
 */
const REFLECTOR_CEX_ORACLE =
  'CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN';

/** Mainnet. Issuers and SACs verified against chain on 2026-10-09. */
const MAINNET: AssetDefinition[] = [
  {
    symbol: 'USDC',
    code: 'USDC',
    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    contractId: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
    decimals: 7,
    kind: 'CLASSIC',
    displayPrefix: '$',
    displaySuffix: '',
    liteSymbol: 'USD',
    liteName: 'dólar',
    liteDecimals: 2,
    proDecimals: 7,
    reflectorFeed: { contractId: REFLECTOR_CEX_ORACLE, asset: 'USDC' },
    maxSlippageBps: 50,
    isFundingAsset: true,
  },
  {
    symbol: 'EURC',
    code: 'EURC',
    issuer: 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2',
    contractId: 'CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV',
    decimals: 7,
    kind: 'CLASSIC',
    displayPrefix: '€',
    displaySuffix: '',
    liteSymbol: 'EUR',
    liteName: 'euro',
    liteDecimals: 2,
    proDecimals: 7,
    reflectorFeed: { contractId: REFLECTOR_CEX_ORACLE, asset: 'EURC' },
    maxSlippageBps: 50,
    isFundingAsset: false,
  },
  {
    symbol: 'XLM',
    code: 'XLM',
    // The native asset has no issuer. DeFindex reports its symbol as "native";
    // normalizing that to XLM is this registry's job, so nothing downstream has
    // to special-case the string.
    issuer: null,
    contractId: 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
    decimals: 7,
    kind: 'NATIVE',
    displayPrefix: '',
    displaySuffix: ' XLM',
    liteSymbol: 'XLM',
    liteName: 'XLM',
    liteDecimals: 2,
    proDecimals: 7,
    reflectorFeed: { contractId: REFLECTOR_CEX_ORACLE, asset: 'XLM' },
    // Wider than the stablecoins: XLM moves, so a tight ceiling would just make
    // conversions fail.
    maxSlippageBps: 100,
    isFundingAsset: false,
  },
];

/**
 * Testnet. USDC here is the issuer the repo has always used; BlindPay delivers
 * USDB rather than USDC on dev instances, which is why `BLINDPAY_TOKEN` exists
 * separately. EURC has no canonical testnet issuer, so it is absent — a vault in
 * an asset the registry does not know is rejected rather than half-supported.
 */
const TESTNET: AssetDefinition[] = [
  {
    symbol: 'USDC',
    code: 'USDC',
    issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    // Not verified on testnet. Soroban paths are unavailable until it is.
    contractId: null,
    decimals: 7,
    kind: 'CLASSIC',
    displayPrefix: '$',
    displaySuffix: '',
    liteSymbol: 'USD',
    liteName: 'dólar',
    liteDecimals: 2,
    proDecimals: 7,
    reflectorFeed: null,
    maxSlippageBps: 50,
    isFundingAsset: true,
  },
  {
    symbol: 'XLM',
    code: 'XLM',
    issuer: null,
    // Not verified on testnet.
    contractId: null,
    decimals: 7,
    kind: 'NATIVE',
    displayPrefix: '',
    displaySuffix: ' XLM',
    liteSymbol: 'XLM',
    liteName: 'XLM',
    liteDecimals: 2,
    proDecimals: 7,
    reflectorFeed: null,
    maxSlippageBps: 100,
    isFundingAsset: false,
  },
];

const BY_NETWORK: Record<string, AssetDefinition[]> = {
  mainnet: MAINNET,
  testnet: TESTNET,
};

const STELLAR_ACCOUNT = /^G[A-Z2-7]{55}$/;
const STELLAR_CONTRACT = /^C[A-Z2-7]{55}$/;

/**
 * Validates a set of definitions and returns every problem found.
 *
 * Collects instead of throwing on the first error: this runs at boot over
 * hand-authored config, and seeing all the mistakes at once beats one restart per
 * typo.
 */
export function validateAssetRegistry(assets: AssetDefinition[]): string[] {
  const errors: string[] = [];

  if (assets.length === 0) return ['asset registry is empty'];

  const seenSymbols = new Set<string>();
  for (const [i, a] of assets.entries()) {
    const at = `assets[${i}]${a.symbol ? ` (${a.symbol})` : ''}`;

    if (!a.symbol?.trim()) errors.push(`${at}.symbol is required`);
    else if (seenSymbols.has(a.symbol))
      errors.push(`${at}.symbol is duplicated`);
    else seenSymbols.add(a.symbol);

    if (!a.code?.trim()) errors.push(`${at}.code is required`);

    if (a.kind === 'NATIVE') {
      if (a.issuer !== null)
        errors.push(`${at}.issuer must be null for NATIVE`);
    } else if (a.kind === 'CLASSIC') {
      if (!a.issuer) errors.push(`${at}.issuer is required for CLASSIC`);
      else if (!STELLAR_ACCOUNT.test(a.issuer)) {
        errors.push(`${at}.issuer is not a Stellar account id`);
      }
    } else {
      errors.push(`${at}.kind must be NATIVE or CLASSIC`);
    }

    if (a.contractId !== null && !STELLAR_CONTRACT.test(a.contractId)) {
      errors.push(`${at}.contractId is not a Stellar contract id`);
    }

    if (!Number.isInteger(a.decimals) || a.decimals < 0) {
      errors.push(`${at}.decimals must be a non-negative integer`);
    }
    if (!Number.isInteger(a.maxSlippageBps) || a.maxSlippageBps < 0) {
      errors.push(`${at}.maxSlippageBps must be a non-negative integer`);
    }
  }

  // Exactly one funding asset, because "what the ramp delivers" has one answer.
  const funding = assets.filter((a) => a.isFundingAsset);
  if (funding.length !== 1) {
    errors.push(
      `exactly one asset must set isFundingAsset, found ${funding.length}`,
    );
  }

  return errors;
}

/**
 * The registry for a network, with an optional full override.
 *
 * `STELLAR_ASSETS_JSON` replaces the built-in list entirely, so a new asset can
 * be added on Railway without a deploy of this file.
 */
export function readAssetRegistry(
  network: string,
  overrideJson?: string,
): AssetDefinition[] {
  let assets: AssetDefinition[];

  if (overrideJson?.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(overrideJson);
    } catch (err) {
      throw new Error(
        `STELLAR_ASSETS_JSON is not valid JSON: ${(err as Error).message}`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error('STELLAR_ASSETS_JSON must be an array of assets');
    }
    assets = parsed as AssetDefinition[];
  } else {
    const builtin = BY_NETWORK[network];
    if (!builtin) {
      throw new Error(
        `No asset registry for network "${network}" (known: ${Object.keys(BY_NETWORK).join(', ')})`,
      );
    }
    assets = builtin;
  }

  const errors = validateAssetRegistry(assets);
  if (errors.length > 0) {
    throw new Error(
      `Asset registry for "${network}" is invalid:\n  - ${errors.join('\n  - ')}`,
    );
  }

  return assets;
}

/** `USDC:GA5Z…` for a classic asset, the bare `XLM` for the native one. */
export function assetIdOf(asset: AssetDefinition): string {
  return asset.kind === 'NATIVE' ? asset.code : `${asset.code}:${asset.issuer}`;
}

/**
 * Resolves a symbol as reported by any source.
 *
 * Accepts DeFindex's `"native"` for XLM: that string reaches us from
 * `getVaultInfo` and from the strategies catalog, and translating it here keeps
 * the special case in one place.
 */
export function findAssetBySymbol(
  assets: AssetDefinition[],
  symbol: string | null | undefined,
): AssetDefinition | null {
  if (!symbol) return null;
  const wanted = symbol.trim().toUpperCase();
  const normalized = wanted === 'NATIVE' ? 'XLM' : wanted;
  return assets.find((a) => a.symbol.toUpperCase() === normalized) ?? null;
}

/**
 * The SAC id, or a thrown error naming what is missing.
 *
 * Soroban callers go through this rather than reading `contractId` directly, so an
 * unverified asset fails loudly at the call site instead of sending a malformed
 * address to the network.
 */
export function requireContractId(asset: AssetDefinition): string {
  if (!asset.contractId) {
    throw new Error(
      `Asset ${asset.symbol} has no verified Stellar Asset Contract id on this network`,
    );
  }
  return asset.contractId;
}

/**
 * The asset as Horizon's `/paths` query expects it.
 *
 * Deliberately not {@link assetIdOf}: that returns `XLM` for the native asset,
 * matching how `getWalletBalances` reports a balance, while the path finder wants
 * the literal `native`. Reusing the first for the second silently returns no
 * route at all.
 */
export function horizonPathAssetParam(asset: AssetDefinition): string {
  return asset.kind === 'NATIVE' ? 'native' : `${asset.code}:${asset.issuer}`;
}
