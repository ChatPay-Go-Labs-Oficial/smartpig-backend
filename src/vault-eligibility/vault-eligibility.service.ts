import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { VaultEducationLockedError } from './vault-eligibility.errors';
import { UpsertVaultEligibilityPolicyDto } from './dto/upsert-vault-eligibility-policy.dto';

export interface VaultEligibilityResult {
  eligible: boolean;
  mode: 'LITE' | 'PRO';
  source: 'PRO_BYPASS' | 'USDC_OPEN' | 'PERSISTED_UNLOCK' | 'POLICY';
  vaultId: string;
  assetSymbol?: string;
  newlyUnlocked?: boolean;
  currentLevel?: number;
  minimumLevel?: number;
  missingModules?: string[];
  policyVersion?: number;
}

/**
 * The education gate for new deposits.
 *
 * It deliberately knows nothing about visibility, withdrawals or disclosure:
 * those are separate product/compliance decisions. Once a Lite user satisfies a
 * published policy, the unlock row is permanent; later policy calibration cannot
 * trap someone who had already acquired access.
 */
@Injectable()
export class VaultEligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async listPolicies(vaultId: string) {
    await this.assertVaultExists(vaultId);
    return this.prisma.vaultEligibilityPolicy.findMany({
      where: { vaultId },
      orderBy: { version: 'desc' },
      include: {
        requiredModules: {
          orderBy: { module: { displayOrder: 'asc' } },
          select: { module: { select: { key: true, title: true } } },
        },
      },
    });
  }

  async upsertPolicy(vaultId: string, dto: UpsertVaultEligibilityPolicyDto) {
    await this.assertVaultExists(vaultId);
    const uniqueKeys = [...new Set(dto.requiredModuleKeys)];
    const modules = await this.prisma.learningModule.findMany({
      where: { key: { in: uniqueKeys }, isPublished: true },
      select: { id: true, key: true },
    });
    if (modules.length !== uniqueKeys.length) {
      const found = new Set(modules.map((module) => module.key));
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_ELIGIBILITY_MODULES',
        details: { missing: uniqueKeys.filter((key) => !found.has(key)) },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`vault-policy:${vaultId}`}))`,
      );

      const existing = await tx.vaultEligibilityPolicy.findUnique({
        where: { vaultId_version: { vaultId, version: dto.version } },
        include: {
          requiredModules: {
            select: { module: { select: { key: true, title: true } } },
          },
        },
      });
      if (existing?.publishedAt) {
        const existingKeys = existing.requiredModules
          .map((item) => item.module.key)
          .sort();
        const requestedKeys = [...uniqueKeys].sort();
        const isIdempotentRetry =
          dto.publish &&
          existing.minimumLevel === dto.minimumLevel &&
          existingKeys.length === requestedKeys.length &&
          existingKeys.every((key, index) => key === requestedKeys[index]);
        if (isIdempotentRetry) return existing;

        throw new ConflictException({
          statusCode: 409,
          code: 'PUBLISHED_ELIGIBILITY_POLICY_IMMUTABLE',
          message: 'Publish a new policy version instead of changing this one.',
        });
      }

      if (dto.publish) {
        await tx.vaultEligibilityPolicy.updateMany({
          where: { vaultId, isActive: true, NOT: { version: dto.version } },
          data: { isActive: false },
        });
      }

      const policy = await tx.vaultEligibilityPolicy.upsert({
        where: { vaultId_version: { vaultId, version: dto.version } },
        create: {
          vaultId,
          version: dto.version,
          minimumLevel: dto.minimumLevel,
          isActive: dto.publish,
          publishedAt: dto.publish ? new Date() : null,
        },
        update: {
          minimumLevel: dto.minimumLevel,
          isActive: dto.publish,
          ...(dto.publish ? { publishedAt: new Date() } : {}),
        },
      });

      await tx.vaultEligibilityRequiredModule.deleteMany({
        where: { policyId: policy.id },
      });
      if (modules.length > 0) {
        await tx.vaultEligibilityRequiredModule.createMany({
          data: modules.map((module) => ({
            policyId: policy.id,
            moduleId: module.id,
          })),
          skipDuplicates: true,
        });
      }

      if (dto.publish) {
        await this.materializePolicyUnlocks(tx, {
          id: policy.id,
          vaultId,
          version: policy.version,
          minimumLevel: policy.minimumLevel,
          requiredModuleIds: modules.map((module) => module.id),
        });
      }

      return tx.vaultEligibilityPolicy.findUnique({
        where: { id: policy.id },
        include: {
          requiredModules: {
            select: { module: { select: { key: true, title: true } } },
          },
        },
      });
    });
  }

  private async materializePolicyUnlocks(
    tx: Prisma.TransactionClient,
    policy: {
      id: string;
      vaultId: string;
      version: number;
      minimumLevel: number;
      requiredModuleIds: string[];
    },
  ): Promise<void> {
    const candidates = await tx.user.findMany({
      where: {
        experienceMode: 'LITE',
        experienceAccount: {
          is: { currentLevel: { gte: policy.minimumLevel } },
        },
        vaultUnlocks: { none: { vaultId: policy.vaultId } },
      },
      select: {
        id: true,
        experienceAccount: { select: { currentLevel: true } },
        learningModules: {
          where: {
            moduleId: { in: policy.requiredModuleIds },
            completedAt: { not: null },
          },
          select: { moduleId: true },
        },
      },
    });
    const required = new Set(policy.requiredModuleIds);
    const qualified = candidates.filter((candidate) => {
      const completed = new Set(
        candidate.learningModules.map((progress) => progress.moduleId),
      );
      return [...required].every((moduleId) => completed.has(moduleId));
    });

    if (qualified.length > 0) {
      await tx.userVaultUnlock.createMany({
        data: qualified.map((candidate) => ({
          userId: candidate.id,
          vaultId: policy.vaultId,
          policyId: policy.id,
          policyVersion: policy.version,
          levelAtUnlock: candidate.experienceAccount?.currentLevel ?? 0,
        })),
        skipDuplicates: true,
      });
    }
  }

  private async assertVaultExists(vaultId: string): Promise<void> {
    const vault = await this.prisma.vaultCatalog.findUnique({
      where: { id: vaultId },
      select: { id: true },
    });
    if (!vault) throw new NotFoundException(`Vault ${vaultId} not found`);
  }

  async assertEligibleForDeposit(
    userId: string,
    vaultId: string,
    vaultAssetSymbol: string,
  ): Promise<VaultEligibilityResult> {
    const result = await this.evaluate(userId, vaultId, vaultAssetSymbol, true);

    if (
      !result.eligible &&
      this.config.get<boolean>('ENFORCE_VAULT_EDUCATION', false)
    ) {
      throw new VaultEducationLockedError({
        vaultId,
        currentLevel: result.currentLevel ?? 0,
        minimumLevel: result.minimumLevel ?? null,
        missingModules: result.missingModules ?? [],
        policyVersion: result.policyVersion ?? null,
      });
    }

    return result;
  }

  /**
   * Materializes every entitlement the user currently qualifies for. Learning
   * calls this after a successful credit/module completion; the deposit path
   * still re-evaluates as a final safety boundary. A policy change can grant a
   * new unlock, but the durable row means it can never revoke an old one.
   */
  async refreshUnlocksForUser(
    userId: string,
  ): Promise<VaultEligibilityResult[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { experienceMode: true },
    });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    if ((user.experienceMode ?? 'PRO') !== 'LITE') return [];

    const publishedPolicies = await this.prisma.vaultEligibilityPolicy.findMany(
      {
        where: { isActive: true, publishedAt: { not: null } },
        orderBy: [{ vaultId: 'asc' }, { version: 'desc' }],
        select: {
          vaultId: true,
          vault: { select: { assetSymbol: true } },
        },
      },
    );
    const seenVaults = new Set<string>();
    const policies = publishedPolicies.filter((policy) => {
      if (seenVaults.has(policy.vaultId)) return false;
      seenVaults.add(policy.vaultId);
      return true;
    });

    return Promise.all(
      policies.map((policy) =>
        this.evaluate(userId, policy.vaultId, policy.vault.assetSymbol, true),
      ),
    );
  }

  /**
   * Read model for a future vault-list/detail integration. `persistUnlock` is
   * false by default so merely viewing a product does not write financial access
   * state. The deposit gate calls it with true after all requirements pass.
   */
  async getEligibility(
    userId: string,
    vaultId: string,
    vaultAssetSymbol: string,
  ): Promise<VaultEligibilityResult> {
    return this.evaluate(userId, vaultId, vaultAssetSymbol, false);
  }

  private async evaluate(
    userId: string,
    vaultId: string,
    vaultAssetSymbol: string,
    persistUnlock: boolean,
  ): Promise<VaultEligibilityResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { experienceMode: true },
    });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    // Compatibility contract: all pre-existing null rows are effectively PRO.
    const mode = user.experienceMode ?? 'PRO';
    if (mode === 'PRO') {
      return {
        eligible: true,
        mode,
        source: 'PRO_BYPASS',
        vaultId,
        assetSymbol: vaultAssetSymbol.toUpperCase(),
      };
    }

    if (vaultAssetSymbol.toUpperCase() === 'USDC') {
      return {
        eligible: true,
        mode,
        source: 'USDC_OPEN',
        vaultId,
        assetSymbol: 'USDC',
      };
    }

    const existingUnlock = await this.prisma.userVaultUnlock.findUnique({
      where: { userId_vaultId: { userId, vaultId } },
      select: { policyVersion: true, levelAtUnlock: true },
    });
    if (existingUnlock) {
      return {
        eligible: true,
        mode,
        source: 'PERSISTED_UNLOCK',
        vaultId,
        assetSymbol: vaultAssetSymbol.toUpperCase(),
        currentLevel: existingUnlock.levelAtUnlock,
        policyVersion: existingUnlock.policyVersion,
      };
    }

    const policy = await this.prisma.vaultEligibilityPolicy.findFirst({
      where: { vaultId, isActive: true, publishedAt: { not: null } },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        minimumLevel: true,
        requiredModules: {
          select: {
            moduleId: true,
            module: { select: { key: true } },
          },
        },
      },
    });

    // Lite fails closed: an advanced vault without a published education policy
    // must not accidentally become unrestricted because of an operator omission.
    if (!policy) {
      return {
        eligible: false,
        mode,
        source: 'POLICY',
        vaultId,
        assetSymbol: vaultAssetSymbol.toUpperCase(),
        currentLevel: 0,
        missingModules: [],
      };
    }

    const [account, completed] = await Promise.all([
      this.prisma.experienceAccount.findUnique({
        where: { userId },
        select: { currentLevel: true },
      }),
      this.prisma.userLearningModuleProgress.findMany({
        where: {
          userId,
          moduleId: { in: policy.requiredModules.map((item) => item.moduleId) },
          completedAt: { not: null },
        },
        select: { moduleId: true },
      }),
    ]);

    const currentLevel = account?.currentLevel ?? 0;
    const completedIds = new Set(completed.map((item) => item.moduleId));
    const missingModules = policy.requiredModules
      .filter((item) => !completedIds.has(item.moduleId))
      .map((item) => item.module.key);
    const eligible =
      currentLevel >= policy.minimumLevel && missingModules.length === 0;

    if (eligible && persistUnlock) {
      await this.prisma.userVaultUnlock.upsert({
        where: { userId_vaultId: { userId, vaultId } },
        create: {
          userId,
          vaultId,
          policyId: policy.id,
          policyVersion: policy.version,
          levelAtUnlock: currentLevel,
        },
        // A retry must not rewrite the evidence of the first acquisition.
        update: {},
      });
    }

    return {
      eligible,
      mode,
      source: 'POLICY',
      vaultId,
      assetSymbol: vaultAssetSymbol.toUpperCase(),
      newlyUnlocked: eligible && persistUnlock,
      currentLevel,
      minimumLevel: policy.minimumLevel,
      missingModules,
      policyVersion: policy.version,
    };
  }
}
