import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DisclosureService } from './disclosure.service';
import {
  assertVaultConfigRecord,
  validateRiskEntries,
} from './vault-config.schema';
import {
  DisclosureMissingError,
  VaultNotFoundError,
} from './vault-registry.errors';
import type {
  CreateDisclosureDto,
  ImportVaultDto,
  UpdateVaultRegistryDto,
} from './dto/update-vault-registry.dto';

/**
 * Operator-side registry mutations: list, activate, curate, import, and publish
 * disclosures.
 *
 * These are what make vault activation, deactivation and metadata a runtime
 * control rather than a deploy. Reachable only with the admin key — see
 * `@AdminOnly()`, which unlike `@Admin()` does not fall through to bearer auth.
 */
@Injectable()
export class VaultRegistryAdminService {
  private readonly logger = new Logger(VaultRegistryAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly disclosures: DisclosureService,
  ) {}

  /** Every row, including the inactive ones an operator still needs to see. */
  async listAll() {
    const vaults = await this.prisma.vaultCatalog.findMany({
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        defindexVaultId: true,
        name: true,
        assetSymbol: true,
        assetDecimals: true,
        assetContractId: true,
        protocol: true,
        isActive: true,
        depositsEnabled: true,
        isCurated: true,
        isFeatured: true,
        displayOrder: true,
        apy: true,
        tvl: true,
        discoveredName: true,
        discoveredAssetSymbol: true,
        lastSeenAt: true,
        lastSyncedAt: true,
        configSchemaVersion: true,
        _count: { select: { disclosures: true } },
      },
    });

    const currentVersions = await this.disclosures.currentVersionsFor(
      vaults.map((v) => v.id),
    );

    return vaults.map((vault) => ({
      ...vault,
      publishedDisclosureVersion:
        currentVersions.get(vault.id)?.version ?? null,
    }));
  }

  /**
   * Applies runtime changes.
   *
   * Activating a non-USDC vault requires a published disclosure. Without that
   * check an operator could list a vault users are then blocked from depositing
   * into at the last step. USDC follows the same product exemption as deposits.
   */
  async update(id: string, dto: UpdateVaultRegistryDto) {
    const existing = await this.prisma.vaultCatalog.findUnique({
      where: { id },
      select: { id: true, isActive: true, assetSymbol: true },
    });
    if (!existing) throw new VaultNotFoundError(id);

    if (
      dto.isActive === true &&
      !existing.isActive &&
      existing.assetSymbol.toUpperCase() !== 'USDC'
    ) {
      const current = await this.disclosures.findCurrent(id);
      if (!current) throw new DisclosureMissingError(id);
    }

    if (dto.configRecord !== undefined) {
      assertVaultConfigRecord(dto.configRecord, `configRecord for vault ${id}`);
    }

    // A single featured vault, otherwise the app's `find(isFeatured)` picks
    // whichever row the database happened to return first.
    if (dto.isFeatured === true) {
      await this.prisma.vaultCatalog.updateMany({
        where: { isFeatured: true, id: { not: id } },
        data: { isFeatured: false },
      });
    }

    const data: Prisma.VaultCatalogUpdateInput = {
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.depositsEnabled !== undefined
        ? { depositsEnabled: dto.depositsEnabled }
        : {}),
      ...(dto.isCurated !== undefined ? { isCurated: dto.isCurated } : {}),
      ...(dto.displayOrder !== undefined
        ? { displayOrder: dto.displayOrder }
        : {}),
      ...(dto.isFeatured !== undefined ? { isFeatured: dto.isFeatured } : {}),
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.assetSymbol !== undefined
        ? { assetSymbol: dto.assetSymbol }
        : {}),
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.assetDecimals !== undefined
        ? { assetDecimals: dto.assetDecimals }
        : {}),
      ...(dto.assetContractId !== undefined
        ? { assetContractId: dto.assetContractId }
        : {}),
      ...(dto.configRecord !== undefined
        ? { configRecord: dto.configRecord as Prisma.InputJsonValue }
        : {}),
    };

    // Editing display metadata implies curating it; otherwise the discovery job
    // would undo the operator's edit within six hours.
    const editsDisplayMetadata =
      dto.name !== undefined ||
      dto.assetSymbol !== undefined ||
      dto.description !== undefined;
    if (editsDisplayMetadata && dto.isCurated === undefined) {
      data.isCurated = true;
    }

    const updated = await this.prisma.vaultCatalog.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        assetSymbol: true,
        isActive: true,
        depositsEnabled: true,
        isCurated: true,
        isFeatured: true,
        displayOrder: true,
      },
    });

    this.logger.log(
      `Vault ${id} updated: ${JSON.stringify({
        isActive: updated.isActive,
        depositsEnabled: updated.depositsEnabled,
      })}`,
    );

    return updated;
  }

  /**
   * Registers a vault DeFindex deployed, without going through the factory.
   *
   * Lands inactive so listing stays a separate, deliberate step.
   */
  async import(dto: ImportVaultDto) {
    if (dto.configRecord !== undefined) {
      assertVaultConfigRecord(
        dto.configRecord,
        `configRecord for ${dto.defindexVaultId}`,
      );
    }

    const existing = await this.prisma.vaultCatalog.findUnique({
      where: { defindexVaultId: dto.defindexVaultId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        message: `Vault ${dto.defindexVaultId} is already registered`,
        code: 'VAULT_ALREADY_REGISTERED',
        details: { vaultId: existing.id },
      });
    }

    return this.prisma.vaultCatalog.create({
      data: {
        defindexVaultId: dto.defindexVaultId,
        protocol: dto.protocol ?? 'DEFINDEX',
        name: dto.name,
        assetSymbol: dto.assetSymbol,
        assetDecimals: dto.assetDecimals ?? 7,
        assetContractId: dto.assetContractId,
        description: dto.description,
        configRecord: dto.configRecord as Prisma.InputJsonValue | undefined,
        isCurated: true,
        isActive: false,
      },
      select: { id: true, defindexVaultId: true, name: true, isActive: true },
    });
  }

  async listDisclosures(vaultId: string) {
    await this.assertVaultExists(vaultId);
    return this.prisma.vaultDisclosure.findMany({
      where: { vaultId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        risks: true,
        sections: true,
        publishedAt: true,
        createdAt: true,
        _count: { select: { acknowledgments: true } },
      },
    });
  }

  /**
   * Creates a disclosure version.
   *
   * The risks are validated with the same rules the config record uses, so a typo
   * in a code cannot reach an app that would then render nothing for it.
   */
  async createDisclosure(vaultId: string, dto: CreateDisclosureDto) {
    await this.assertVaultExists(vaultId);
    this.assertRisksValid(dto.risks, vaultId);

    const version = dto.version ?? (await this.nextVersion(vaultId));

    const existing = await this.prisma.vaultDisclosure.findUnique({
      where: { vaultId_version: { vaultId, version } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        message: `Disclosure v${version} already exists for vault ${vaultId}`,
        code: 'DISCLOSURE_VERSION_EXISTS',
        details: { vaultId, version },
      });
    }

    const created = await this.prisma.vaultDisclosure.create({
      data: {
        vaultId,
        version,
        risks: dto.risks as unknown as Prisma.InputJsonValue,
        sections: dto.sections as Prisma.InputJsonValue | undefined,
        publishedAt: dto.publish ? new Date() : null,
      },
      select: { id: true, version: true, publishedAt: true },
    });

    if (created.publishedAt) this.disclosures.invalidate(vaultId);

    return created;
  }

  async publishDisclosure(vaultId: string, version: number) {
    const disclosure = await this.prisma.vaultDisclosure.findUnique({
      where: { vaultId_version: { vaultId, version } },
      select: { id: true, publishedAt: true },
    });
    if (!disclosure) {
      throw new ConflictException({
        message: `Disclosure v${version} does not exist for vault ${vaultId}`,
        code: 'DISCLOSURE_VERSION_NOT_FOUND',
        details: { vaultId, version },
      });
    }

    // Idempotent: publishing twice keeps the original timestamp, because that is
    // the moment the text became binding.
    if (disclosure.publishedAt) {
      return { vaultId, version, publishedAt: disclosure.publishedAt };
    }

    const published = await this.prisma.vaultDisclosure.update({
      where: { id: disclosure.id },
      data: { publishedAt: new Date() },
      select: { version: true, publishedAt: true },
    });

    this.disclosures.invalidate(vaultId);
    this.logger.log(`Disclosure v${version} published for vault ${vaultId}`);

    return { vaultId, ...published };
  }

  private async nextVersion(vaultId: string): Promise<number> {
    const latest = await this.prisma.vaultDisclosure.findFirst({
      where: { vaultId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (latest?.version ?? 0) + 1;
  }

  private async assertVaultExists(vaultId: string) {
    const vault = await this.prisma.vaultCatalog.findUnique({
      where: { id: vaultId },
      select: { id: true },
    });
    if (!vault) throw new VaultNotFoundError(vaultId);
  }

  private assertRisksValid(risks: unknown, vaultId: string) {
    const errors = validateRiskEntries(risks);
    if (errors.length > 0) {
      throw new ConflictException({
        message: `Invalid risks for vault ${vaultId}`,
        code: 'DISCLOSURE_RISKS_INVALID',
        details: { errors },
      });
    }
  }
}
