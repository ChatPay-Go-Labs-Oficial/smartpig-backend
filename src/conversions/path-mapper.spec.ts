import { Asset } from '@stellar/stellar-sdk';
import { describePath, toPathAssets } from './path-mapper';

const EURC_ISSUER = 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2';

describe('toPathAssets', () => {
  it('maps a native hop to Asset.native()', () => {
    // The hop a USDC→EURC route is most likely to take, since XLM is the deepest
    // pair on the network. The dead lib/stellar/swap.ts passed Horizon's raw JSON
    // straight into the operation, which breaks precisely here.
    const [asset] = toPathAssets([{ asset_type: 'native' }]);

    expect(asset).toBeInstanceOf(Asset);
    expect(asset.isNative()).toBe(true);
  });

  it('maps a credit hop to a code/issuer asset', () => {
    const [asset] = toPathAssets([
      {
        asset_type: 'credit_alphanum4',
        asset_code: 'EURC',
        asset_issuer: EURC_ISSUER,
      },
    ]);

    expect(asset.getCode()).toBe('EURC');
    expect(asset.getIssuer()).toBe(EURC_ISSUER);
  });

  it('preserves hop order, which the operation depends on', () => {
    const assets = toPathAssets([
      { asset_type: 'native' },
      {
        asset_type: 'credit_alphanum4',
        asset_code: 'EURC',
        asset_issuer: EURC_ISSUER,
      },
    ]);

    expect(assets.map((a) => (a.isNative() ? 'XLM' : a.getCode()))).toEqual([
      'XLM',
      'EURC',
    ]);
  });

  it('returns an empty array for a direct route', () => {
    // hops=0 is what Horizon reports for USDC→EURC and USDC→XLM today.
    expect(toPathAssets([])).toEqual([]);
  });

  it.each([null, undefined, 'not-an-array', 42, {}])(
    'returns an empty array for %p rather than throwing',
    (input) => {
      expect(toPathAssets(input)).toEqual([]);
    },
  );

  it('throws on a credit hop missing its issuer', () => {
    // Guessing here would send a malformed asset to the network.
    expect(() =>
      toPathAssets([{ asset_type: 'credit_alphanum4', asset_code: 'EURC' }]),
    ).toThrow(/Path hop 0 is neither native nor a complete credit asset/);
  });

  it('names the offending index when several hops are given', () => {
    expect(() =>
      toPathAssets([
        { asset_type: 'native' },
        { asset_type: 'credit_alphanum4', asset_issuer: EURC_ISSUER },
      ]),
    ).toThrow(/Path hop 1/);
  });
});

describe('describePath', () => {
  it('describes a mixed route for logs and records', () => {
    expect(
      describePath([
        { asset_type: 'native' },
        {
          asset_type: 'credit_alphanum4',
          asset_code: 'EURC',
          asset_issuer: EURC_ISSUER,
        },
      ]),
    ).toEqual(['XLM', `EURC:${EURC_ISSUER}`]);
  });

  it('describes a direct route as empty', () => {
    expect(describePath([])).toEqual([]);
  });
});
