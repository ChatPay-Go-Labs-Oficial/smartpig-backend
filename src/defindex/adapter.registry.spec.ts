import { NotFoundException } from '@nestjs/common';
import { VaultAdapterRegistry } from './adapter.registry';

function createRegistry() {
  const defindex = { protocol: 'DEFINDEX' };
  return new VaultAdapterRegistry(defindex as unknown as never);
}

describe('VaultAdapterRegistry', () => {
  it('resolves the DeFindex adapter', () => {
    expect(createRegistry().get('DEFINDEX').protocol).toBe('DEFINDEX');
  });

  it('is case-insensitive, so a hand-edited row still resolves', () => {
    expect(createRegistry().get('defindex').protocol).toBe('DEFINDEX');
  });

  it('throws for an unknown protocol instead of defaulting', () => {
    // Treating an unrecognised protocol as DeFindex would send a deposit to the
    // wrong integration. A configuration mistake has to be loud.
    const registry = createRegistry();

    expect(() => registry.get('AQUARIUS')).toThrow(NotFoundException);
    expect(() => registry.get('AQUARIUS')).toThrow(/known: DEFINDEX/);
  });

  it.each([undefined, null, ''])('throws for %p', (protocol) => {
    expect(() => createRegistry().get(protocol as unknown as string)).toThrow(
      NotFoundException,
    );
  });

  it('reports what it supports', () => {
    const registry = createRegistry();

    expect(registry.supports('DEFINDEX')).toBe(true);
    expect(registry.supports('AQUARIUS')).toBe(false);
    expect(registry.listProtocols()).toEqual(['DEFINDEX']);
  });
});
