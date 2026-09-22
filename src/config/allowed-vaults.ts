import { ConfigService } from '@nestjs/config';

/**
 * The vaults this deployment works with, as `VaultCatalog` ids.
 *
 * `ALLOWED_VAULT_IDS` is a comma-separated list. An empty value means there is no
 * allowlist and the whole catalog is in play, which is what a fresh environment
 * gets — the same reading `VaultsService.listVaults` has always used.
 *
 * It lives here because two callers now depend on it meaning the same thing: the
 * catalog the app lists, and the vaults the deletion check reads balances from. A
 * second copy of this parsing is how the two would drift apart.
 */
export function readAllowedVaultIds(config: ConfigService): string[] {
  return config
    .get<string>('ALLOWED_VAULT_IDS', '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}
