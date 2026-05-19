import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ManagedVaultStatus } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexService } from '../defindex/defindex.service';
import { CreateManagedVaultDto } from './dto/create-managed-vault.dto';
import { SubmitManagedVaultDto } from './dto/submit-managed-vault.dto';

@Injectable()
export class VaultManagerService {
  private readonly logger = new Logger(VaultManagerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly defindex: DefindexService,
  ) {}

  async createVault(dto: CreateManagedVaultDto) {
    const result = await this.defindex.createVault({
      caller: dto.callerAddress,
      roles: dto.roles,
      name: dto.name,
      symbol: dto.symbol,
      vaultFee: dto.vaultFeeBps,
      upgradable: dto.upgradable ?? true,
      assets: dto.assets,
    });

    const managed = await this.prisma.managedVault.create({
      data: {
        creatorUserId: dto.userId,
        callerAddress: dto.callerAddress,
        name: dto.name,
        symbol: dto.symbol,
        description: dto.description,
        vaultFeeBps: dto.vaultFeeBps,
        roles: dto.roles as object,
        assets: dto.assets as object,
        unsignedXdr: result.xdr,
        predictedVaultAddress: result.predictedVaultAddress,
        status: ManagedVaultStatus.PENDING_SIGNATURE,
      },
    });

    this.logger.log(
      `ManagedVault created: id=${managed.id} name=${managed.name}`,
    );

    return {
      id: managed.id,
      name: managed.name,
      symbol: managed.symbol,
      status: managed.status,
      unsignedXdr: result.xdr,
      predictedVaultAddress: result.predictedVaultAddress,
    };
  }

  async submitVault(id: string, dto: SubmitManagedVaultDto) {
    const managed = await this.prisma.managedVault.findUnique({
      where: { id },
    });

    if (!managed) {
      throw new NotFoundException(`ManagedVault ${id} not found`);
    }

    if (managed.status !== ManagedVaultStatus.PENDING_SIGNATURE) {
      throw new BadRequestException(
        `Vault is already ${managed.status} — cannot submit again`,
      );
    }

    await this.prisma.managedVault.update({
      where: { id },
      data: { signedXdr: dto.signedXdr, status: ManagedVaultStatus.SUBMITTED },
    });

    let txResult: Awaited<
      ReturnType<DefindexService['submitSignedTransaction']>
    >;
    try {
      txResult = await this.defindex.submitSignedTransaction({
        xdr: dto.signedXdr,
      });
    } catch (err) {
      await this.prisma.managedVault.update({
        where: { id },
        data: { status: ManagedVaultStatus.FAILED, errorMessage: String(err) },
      });
      throw err;
    }

    // Prefer actual vault address from tx result (VaultCreateResult has vaultAddress field)
    const txResultRaw = txResult.result as
      | { type?: string; vaultAddress?: string }
      | null
      | undefined;
    const vaultAddress =
      txResultRaw?.type === 'vault_create' && txResultRaw.vaultAddress
        ? txResultRaw.vaultAddress
        : managed.predictedVaultAddress;

    // Extract asset symbol from the stored assets JSON (first asset's symbol).
    const assetsJson = managed.assets as Array<{ symbol?: string }>;
    const assetSymbol = assetsJson?.[0]?.symbol ?? 'UNKNOWN';

    let vaultCatalogId: string | undefined;
    if (vaultAddress) {
      const catalog = await this.prisma.vaultCatalog.upsert({
        where: { defindexVaultId: vaultAddress },
        create: {
          defindexVaultId: vaultAddress,
          name: managed.name,
          description: managed.description,
          assetSymbol,
          isActive: true,
          lastSyncedAt: new Date(),
        },
        update: {
          name: managed.name,
          description: managed.description ?? undefined,
          assetSymbol,
          isActive: true,
        },
        select: { id: true },
      });
      vaultCatalogId = catalog.id;
    }

    await this.prisma.managedVault.update({
      where: { id },
      data: {
        status: txResult.success
          ? ManagedVaultStatus.CONFIRMED
          : ManagedVaultStatus.FAILED,
        txHash: txResult.txHash,
        predictedVaultAddress: vaultAddress,
        ...(vaultCatalogId && { vaultCatalogId }),
      },
    });

    this.logger.log(
      `ManagedVault ${id} submitted → txHash=${txResult.txHash} vault=${vaultAddress}`,
    );

    return {
      id,
      txHash: txResult.txHash,
      vaultAddress,
      status: txResult.success
        ? ManagedVaultStatus.CONFIRMED
        : ManagedVaultStatus.FAILED,
    };
  }

  async getVault(id: string) {
    const managed = await this.prisma.managedVault.findUnique({
      where: { id },
      include: { vaultCatalog: true },
    });

    if (!managed) {
      throw new NotFoundException(`ManagedVault ${id} not found`);
    }

    return managed;
  }

  async listVaults(userId: string) {
    return this.prisma.managedVault.findMany({
      where: { creatorUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        vaultCatalog: { select: { apy: true, tvl: true, assetSymbol: true } },
      },
    });
  }
}
