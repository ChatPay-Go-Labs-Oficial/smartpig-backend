import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../infra/prisma/prisma.service';
import { readAllowedVaultIds } from '../config/allowed-vaults';
import { DisclosureService } from './disclosure.service';
import type { VaultConfigRecord } from './vault-config.schema';
import {
  VaultDepositsPausedError,
  VaultNotFoundError,
} from './vault-registry.errors';

/** Everything the app needs to list a vault, including what it previously lacked. */
const LIST_SELECT = {
  id: true,
  defindexVaultId: true,
  name: true,
  assetSymbol: true,
  // Was never exposed: the app hardcoded 7 decimals client-side instead.
  assetDecimals: true,
  assetContractId: true,
  description: true,
  apy: true,
  tvl: true,
  protocol: true,
  depositsEnabled: true,
  isFeatured: true,
  displayOrder: true,
  lastSyncedAt: true,
} as const;

@Injectable()
export class VaultRegistryService {
  private readonly logger = new Logger(VaultRegistryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly disclosures: DisclosureService,
  ) {}

  /**
   * The vaults a user may see, in a deterministic order.
   *
   * Ordering is `displayOrder` then `name`. Name alone used to decide it, which
   * meant adding a vault silently reshuffled which one the app treats as the hero.
   *
   * The `ALLOWED_VAULT_IDS` allowlist is still honoured so the switch to the DB
   * registry is a config change rather than a code risk: empty means no allowlist,
   * which is the end state once the registry is authoritative.
   */
  async listForUser(userId?: string) {
    const allowedIds = readAllowedVaultIds(this.config);

    const vaults = await this.prisma.vaultCatalog.findMany({
      where: {
        isActive: true,
        ...(allowedIds.length > 0 ? { id: { in: allowedIds } } : {}),
      },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      select: LIST_SELECT,
    });

    if (vaults.length === 0) return [];

    const vaultIds = vaults.map((v) => v.id);
    const [currentVersions, acknowledged] = await Promise.all([
      this.disclosures.currentVersionsFor(vaultIds),
      userId
        ? this.disclosures.acknowledgedVersionsFor(userId, vaultIds)
        : Promise.resolve(new Map<string, Set<number>>()),
    ]);

    return vaults.map((vault) => {
      const current = currentVersions.get(vault.id);
      return {
        ...vault,
        disclosure: current
          ? {
              version: current.version,
              // Undefined rather than false for an anonymous caller: "we did not
              // check" is not the same claim as "nothing is required".
              acknowledgmentRequired: userId
                ? !acknowledged.get(vault.id)?.has(current.version)
                : undefined,
            }
          : null,
      };
    });
  }

  /** A vault with its configuration record, for the detail screen. */
  async getOrThrow(id: string, userId?: string) {
    const vault = await this.prisma.vaultCatalog.findUnique({
      where: { id },
      select: {
        ...LIST_SELECT,
        metadata: true,
        configRecord: true,
        configSchemaVersion: true,
        isActive: true,
        isCurated: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!vault || !vault.isActive) throw new VaultNotFoundError(id);

    const { acknowledged, current } = userId
      ? await this.disclosures.hasAcknowledgedCurrent(userId, id)
      : {
          acknowledged: false,
          current: await this.disclosures.findCurrent(id),
        };

    return {
      ...vault,
      configRecord: (vault.configRecord ?? null) as VaultConfigRecord | null,
      disclosure: current
        ? {
            version: current.version,
            risks: current.risks,
            sections: current.sections,
            publishedAt: current.publishedAt,
            acknowledgmentRequired: userId ? !acknowledged : undefined,
          }
        : null,
    };
  }

  /**
   * Resolves a vault for a deposit, or explains why it cannot take one.
   *
   * `depositsEnabled` is checked separately from `isActive` because the two mean
   * different things: an inactive vault is not listed at all, while a vault with
   * deposits paused stays visible and withdrawable. Pausing must never trap funds.
   */
  async assertDepositable(id: string) {
    const vault = await this.prisma.vaultCatalog.findUnique({
      where: { id },
      select: {
        id: true,
        defindexVaultId: true,
        assetSymbol: true,
        assetDecimals: true,
        isActive: true,
        depositsEnabled: true,
        protocol: true,
      },
    });

    if (!vault || !vault.isActive) throw new VaultNotFoundError(id);
    if (!vault.depositsEnabled) throw new VaultDepositsPausedError(id);

    return vault;
  }

  /**
   * Resolves a vault for a withdrawal.
   *
   * Intentionally ignores both the allowlist and `depositsEnabled`: a user holding
   * a position must always be able to get out, even of a vault we have since
   * delisted or frozen for new money.
   */
  async assertWithdrawable(id: string) {
    const vault = await this.prisma.vaultCatalog.findUnique({
      where: { id },
      select: {
        id: true,
        defindexVaultId: true,
        assetSymbol: true,
        assetDecimals: true,
        isActive: true,
        protocol: true,
      },
    });

    if (!vault) throw new VaultNotFoundError(id);
    return vault;
  }
}
