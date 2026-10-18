import { readAllowedVaultIds } from './allowed-vaults';

function configWith(value?: string) {
  return {
    get: jest.fn((key: string, fallback?: string) =>
      key === 'ALLOWED_VAULT_IDS' ? (value ?? fallback) : fallback,
    ),
  } as unknown as Parameters<typeof readAllowedVaultIds>[0];
}

describe('readAllowedVaultIds', () => {
  it('parses a comma-separated list', () => {
    expect(readAllowedVaultIds(configWith('a,b,c'))).toEqual(['a', 'b', 'c']);
  });

  it('trims surrounding whitespace', () => {
    expect(readAllowedVaultIds(configWith(' a , b '))).toEqual(['a', 'b']);
  });

  it('treats an empty value as no allowlist', () => {
    // The migration path once the registry is authoritative: empty means the whole
    // catalog is in play. env.schema has to allow('') for this to be reachable.
    expect(readAllowedVaultIds(configWith(''))).toEqual([]);
  });

  it('treats an absent value as no allowlist', () => {
    expect(readAllowedVaultIds(configWith(undefined))).toEqual([]);
  });

  it('drops empty entries from a trailing or doubled comma', () => {
    expect(readAllowedVaultIds(configWith('a,,b,'))).toEqual(['a', 'b']);
  });

  it('returns no allowlist for a value that is only separators', () => {
    expect(readAllowedVaultIds(configWith(' , , '))).toEqual([]);
  });
});
