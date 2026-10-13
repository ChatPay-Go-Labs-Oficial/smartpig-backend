import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import type { DisclosureSections, RiskEntry } from './types/risk-codes';
import {
  DisclosureMissingError,
  DisclosureVersionStaleError,
} from './vault-registry.errors';

/**
 * Short on purpose. The lookup is on the deposit path, so it must be cheap, but a
 * freshly published version has to take effect in seconds rather than minutes —
 * publishing is how an operator corrects a disclosure.
 */
const CURRENT_VERSION_CACHE_TTL_MS = 60 * 1000;

export interface CurrentDisclosure {
  id: string;
  vaultId: string;
  version: number;
  risks: RiskEntry[];
  sections: DisclosureSections | null;
  publishedAt: Date;
}

export interface AcknowledgmentContext {
  appVersion?: string;
  mode?: 'lite' | 'pro';
  /** The codes actually rendered to the user, for the audit trail. */
  shownCodes?: string[];
}

@Injectable()
export class DisclosureService {
  private readonly logger = new Logger(DisclosureService.name);
  private readonly currentCache = new Map<
    string,
    { value: CurrentDisclosure | null; expiresAt: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  /** The published disclosure with the highest version, or null if there is none. */
  async findCurrent(vaultId: string): Promise<CurrentDisclosure | null> {
    const cached = this.currentCache.get(vaultId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const row = await this.prisma.vaultDisclosure.findFirst({
      where: { vaultId, publishedAt: { not: null } },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        vaultId: true,
        version: true,
        risks: true,
        sections: true,
        publishedAt: true,
      },
    });

    const value: CurrentDisclosure | null = row
      ? {
          id: row.id,
          vaultId: row.vaultId,
          version: row.version,
          risks: (row.risks ?? []) as unknown as RiskEntry[],
          sections: (row.sections ??
            null) as unknown as DisclosureSections | null,
          // Non-null by the `publishedAt: { not: null }` filter above.
          publishedAt: row.publishedAt as Date,
        }
      : null;

    this.currentCache.set(vaultId, {
      value,
      expiresAt: Date.now() + CURRENT_VERSION_CACHE_TTL_MS,
    });

    return value;
  }

  async getCurrentOrThrow(vaultId: string): Promise<CurrentDisclosure> {
    const current = await this.findCurrent(vaultId);
    if (!current) throw new DisclosureMissingError(vaultId);
    return current;
  }

  /** Whether this user has accepted the vault's current version. */
  async hasAcknowledgedCurrent(
    userId: string,
    vaultId: string,
  ): Promise<{ acknowledged: boolean; current: CurrentDisclosure | null }> {
    const current = await this.findCurrent(vaultId);
    if (!current) return { acknowledged: false, current: null };

    const ack = await this.prisma.vaultDisclosureAcknowledgment.findUnique({
      where: {
        userId_vaultId_version: {
          userId,
          vaultId,
          version: current.version,
        },
      },
      select: { id: true },
    });

    return { acknowledged: ack !== null, current };
  }

  /**
   * Records consent for the current version.
   *
   * `expectedVersion` guards the race where a new version is published between the
   * app rendering the sheet and the user tapping accept: accepting the text they
   * actually read is the whole point, so a mismatch is rejected rather than
   * silently recorded against the newer version.
   *
   * Re-posting the same acceptance returns the existing row — the composite unique
   * key makes that idempotent instead of an error.
   */
  async acknowledge(params: {
    userId: string;
    vaultId: string;
    expectedVersion?: number;
    context?: AcknowledgmentContext;
  }) {
    const { userId, vaultId, expectedVersion, context } = params;
    const current = await this.getCurrentOrThrow(vaultId);

    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new DisclosureVersionStaleError(
        vaultId,
        expectedVersion,
        current.version,
      );
    }

    const acknowledgment =
      await this.prisma.vaultDisclosureAcknowledgment.upsert({
        where: {
          userId_vaultId_version: { userId, vaultId, version: current.version },
        },
        create: {
          userId,
          vaultId,
          disclosureId: current.id,
          version: current.version,
          context: context ? (context as object) : undefined,
        },
        // Deliberately not touching acknowledgedAt: the record must keep the moment
        // consent was first given, not the last time the app retried the call.
        update: {},
        select: { id: true, version: true, acknowledgedAt: true },
      });

    return {
      vaultId,
      version: acknowledgment.version,
      acknowledgedAt: acknowledgment.acknowledgedAt,
    };
  }

  /**
   * Which of these vaults the user still owes an acknowledgment for.
   *
   * One grouped query for the whole list, so rendering N vaults does not cost N
   * round trips.
   */
  async acknowledgedVersionsFor(
    userId: string,
    vaultIds: string[],
  ): Promise<Map<string, Set<number>>> {
    const byVault = new Map<string, Set<number>>();
    if (vaultIds.length === 0) return byVault;

    const rows = await this.prisma.vaultDisclosureAcknowledgment.findMany({
      where: { userId, vaultId: { in: vaultIds } },
      select: { vaultId: true, version: true },
    });

    for (const row of rows) {
      const versions = byVault.get(row.vaultId) ?? new Set<number>();
      versions.add(row.version);
      byVault.set(row.vaultId, versions);
    }

    return byVault;
  }

  /** Published versions for the vaults given, in one query. */
  async currentVersionsFor(
    vaultIds: string[],
  ): Promise<Map<string, { version: number; risks: RiskEntry[] }>> {
    const byVault = new Map<string, { version: number; risks: RiskEntry[] }>();
    if (vaultIds.length === 0) return byVault;

    const rows = await this.prisma.vaultDisclosure.findMany({
      where: { vaultId: { in: vaultIds }, publishedAt: { not: null } },
      orderBy: { version: 'desc' },
      select: { vaultId: true, version: true, risks: true },
    });

    // Ordered by version desc, so the first row per vault is the current one.
    for (const row of rows) {
      if (byVault.has(row.vaultId)) continue;
      byVault.set(row.vaultId, {
        version: row.version,
        risks: (row.risks ?? []) as unknown as RiskEntry[],
      });
    }

    return byVault;
  }

  /** Called after publishing, so the new version is not shadowed by the cache. */
  invalidate(vaultId: string) {
    this.currentCache.delete(vaultId);
    this.logger.debug(`Disclosure cache invalidated for vault ${vaultId}`);
  }
}
