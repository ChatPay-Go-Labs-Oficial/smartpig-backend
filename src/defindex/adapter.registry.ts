import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DefindexVaultAdapter } from './defindex-vault.adapter';
import type { VaultAdapter } from './vault-adapter.port';

/**
 * Resolves `VaultCatalog.protocol` to the adapter that speaks it.
 *
 * One implementation today, which is exactly what the deliverable asks for — a
 * common adapter the original vault and the additional ones all go through. The
 * value of the indirection is not hypothetical future protocols; it is that
 * nothing outside this folder names DeFindex, so adding one is a class and a
 * registration rather than a branch in every service.
 */
@Injectable()
export class VaultAdapterRegistry {
  private readonly logger = new Logger(VaultAdapterRegistry.name);
  private readonly adapters = new Map<string, VaultAdapter>();

  constructor(defindex: DefindexVaultAdapter) {
    this.register(defindex);
  }

  private register(adapter: VaultAdapter) {
    this.adapters.set(adapter.protocol.toUpperCase(), adapter);
    this.logger.log(`Vault adapter registered: ${adapter.protocol}`);
  }

  /**
   * Throws rather than falling back to a default.
   *
   * A row whose protocol we cannot serve is a configuration mistake, and silently
   * treating it as DeFindex would send a user's deposit to the wrong integration.
   */
  get(protocol: string): VaultAdapter {
    const adapter = this.adapters.get(protocol?.toUpperCase() ?? '');
    if (!adapter) {
      throw new NotFoundException(
        `No vault adapter for protocol "${protocol}" (known: ${[...this.adapters.keys()].join(', ')})`,
      );
    }
    return adapter;
  }

  supports(protocol: string): boolean {
    return this.adapters.has(protocol?.toUpperCase() ?? '');
  }

  listProtocols(): string[] {
    return [...this.adapters.keys()];
  }
}
