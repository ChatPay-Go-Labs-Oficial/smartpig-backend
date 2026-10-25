import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexService } from '../defindex/defindex.service';
import { Decimal } from '@prisma/client/runtime/library';
import { VaultSyncJob } from '../jobs/vault-sync.job';
import { VaultRegistryService } from '../vault-registry/vault-registry.service';
import { VaultAdapterRegistry } from '../defindex/adapter.registry';
import { VaultEligibilityService } from '../vault-eligibility/vault-eligibility.service';

const APY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class VaultsService {
  private readonly logger = new Logger(VaultsService.name);
  private readonly apyCache = new Map<
    string,
    { apy: number; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly defindex: DefindexService,
    private readonly vaultSyncJob: VaultSyncJob,
    private readonly config: ConfigService,
    private readonly registry: VaultRegistryService,
    private readonly adapters: VaultAdapterRegistry,
    private readonly eligibility: VaultEligibilityService,
  ) {}

  /**
   * Delegates to the registry, which is the single answer to "which vaults".
   *
   * For an app request, the controller resolves `userId` from the verified Privy
   * identity. It personalizes both the disclosure hint and the education access
   * projection. Deposit still repeats both checks as the authoritative boundary.
   */
  async listVaults(userId?: string) {
    const vaults = await this.registry.listForUser(userId);
    if (!userId) return vaults;
    return Promise.all(
      vaults.map(async (vault) => this.withAccessProjection(vault, userId)),
    );
  }

  async getVault(id: string, userId?: string) {
    const vault = await this.registry.getOrThrow(id, userId);
    const projected = userId
      ? await this.withAccessProjection(vault, userId)
      : vault;

    // Live info is best-effort: the detail screen must still render the stored
    // record and the disclosure when DeFindex is unreachable.
    try {
      const liveInfo = await this.defindex.getVaultInfo(vault.defindexVaultId);
      return { ...projected, liveInfo };
    } catch (err) {
      this.logger.warn(
        `Could not fetch live vault info for ${id}: ${(err as Error).message}`,
      );
      return projected;
    }
  }

  async getVaultApy(id: string) {
    const vault = await this.findActiveVaultOrThrow(id);
    const cached = this.apyCache.get(id);

    if (cached && cached.expiresAt > Date.now()) {
      return { vaultId: id, apy: cached.apy, cached: true };
    }

    try {
      const { apy } = await this.defindex.getVaultApy(vault.defindexVaultId);
      this.apyCache.set(id, { apy, expiresAt: Date.now() + APY_CACHE_TTL_MS });

      // Persist apy to DB (fire-and-forget)
      this.prisma.vaultCatalog
        .update({
          where: { id },
          data: { apy: new Decimal(apy), lastSyncedAt: new Date() },
        })
        .catch((e) =>
          this.logger.error(`Failed to persist APY for vault ${id}`, e),
        );

      return { vaultId: id, apy, cached: false };
    } catch (err) {
      // Fallback to stored APY
      if (vault.apy !== null) {
        return {
          vaultId: id,
          apy: Number(vault.apy),
          cached: true,
          stale: true,
        };
      }
      throw err;
    }
  }

  /**
   * The user's position in a vault.
   *
   * Goes through the adapter so the amounts are normalized once, on the side that
   * knows the asset's decimals. `dfTokens` and `underlyingBalance` stay raw for
   * the published app, which divides them client-side; `sharesAsset` and
   * `underlyingBalanceAsset` are the whole-unit values new screens should read.
   * Adding fields rather than changing the existing ones keeps the released build
   * working while the app migrates.
   *
   * Resolved through `assertWithdrawable`, which ignores the allowlist and the
   * deposit pause on purpose: someone holding a position must always be able to
   * read it, even in a vault we have since delisted.
   */
  async getVaultBalance(id: string, walletAddress: string) {
    const vault = await this.registry.assertWithdrawable(id);
    const adapter = this.adapters.get(vault.protocol);

    const position = await adapter.getPosition(
      {
        id: vault.id,
        contractId: vault.defindexVaultId,
        assetSymbol: vault.assetSymbol,
        assetDecimals: vault.assetDecimals,
      },
      walletAddress,
    );

    return {
      vaultId: id,
      walletAddress,
      assetSymbol: vault.assetSymbol,
      assetDecimals: vault.assetDecimals,
      dfTokens: position.raw.dfTokens,
      underlyingBalance: position.raw.underlyingBalance,
      sharesAsset: position.shares,
      underlyingBalanceAsset: position.underlying,
    };
  }

  async triggerSync() {
    await this.vaultSyncJob.syncVaultsFromDefindex();
    return { message: 'Vault sync triggered successfully' };
  }

  private async withAccessProjection<
    T extends {
      id: string;
      assetSymbol: string;
      depositsEnabled: boolean;
      disclosure?: { acknowledgmentRequired?: boolean } | null;
    },
  >(vault: T, userId: string) {
    const education = await this.eligibility.getEligibility(
      userId,
      vault.id,
      vault.assetSymbol,
    );
    const educationEnforced = this.config.get<boolean>(
      'ENFORCE_VAULT_EDUCATION',
      false,
    );
    const disclosureEnforced = this.config.get<boolean>(
      'ENFORCE_VAULT_DISCLOSURE',
      false,
    );
    const disclosureSatisfied =
      !disclosureEnforced || vault.disclosure?.acknowledgmentRequired !== true;
    const educationSatisfied = !educationEnforced || education.eligible;

    return {
      ...vault,
      access: {
        experienceMode: education.mode,
        educationRequired:
          education.mode === 'LITE' && education.source !== 'USDC_OPEN',
        educationUnlocked: education.eligible,
        educationEnforced,
        currentLevel: education.currentLevel ?? null,
        requiredLevel: education.minimumLevel ?? null,
        missingModules: education.missingModules ?? [],
        operationallyAvailable: vault.depositsEnabled,
        disclosureAcknowledged:
          vault.disclosure?.acknowledgmentRequired === undefined
            ? null
            : !vault.disclosure.acknowledgmentRequired,
        canDeposit:
          vault.depositsEnabled && educationSatisfied && disclosureSatisfied,
      },
    };
  }

  private async findActiveVaultOrThrow(id: string) {
    const vault = await this.prisma.vaultCatalog.findUnique({
      where: { id },
      select: { id: true, defindexVaultId: true, apy: true, isActive: true },
    });
    if (!vault || !vault.isActive)
      throw new NotFoundException(`Vault ${id} not found`);
    return vault;
  }
}
