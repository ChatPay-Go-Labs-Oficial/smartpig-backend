import { Asset } from '@stellar/stellar-sdk';

/** A hop as Horizon reports it in a `/paths` record. */
export interface HorizonPathHop {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

/**
 * Converts Horizon's path JSON into SDK `Asset` instances.
 *
 * The dead `lib/stellar/swap.ts` in the app passed these raw objects straight
 * into the operation. That happens to work for a credit asset because the SDK is
 * lenient, and breaks for a `native` hop — which is exactly the hop a
 * USDC → EURC route is most likely to take, since XLM is the deepest pair on the
 * network.
 */
export function toPathAssets(path: unknown): Asset[] {
  if (!Array.isArray(path)) return [];

  return (path as HorizonPathHop[]).map((hop, index) => {
    if (hop?.asset_type === 'native') return Asset.native();

    if (!hop?.asset_code || !hop?.asset_issuer) {
      throw new Error(
        `Path hop ${index} is neither native nor a complete credit asset`,
      );
    }
    return new Asset(hop.asset_code, hop.asset_issuer);
  });
}

/** `XLM` for the native asset, `CODE:ISSUER` otherwise — for logs and records. */
export function describePath(path: unknown): string[] {
  return toPathAssets(path).map((asset) =>
    asset.isNative() ? 'XLM' : `${asset.getCode()}:${asset.getIssuer()}`,
  );
}
