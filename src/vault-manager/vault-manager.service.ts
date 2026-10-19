import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ManagedVaultStatus } from '@prisma/client';
import { Transaction } from '@stellar/stellar-sdk';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexService } from '../defindex/defindex.service';
import { CreateManagedVaultDto } from './dto/create-managed-vault.dto';
import { SubmitManagedVaultDto } from './dto/submit-managed-vault.dto';

@Injectable()
export class VaultManagerService {
  private readonly logger = new Logger(VaultManagerService.name);
  private readonly networkPassphrase: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly defindex: DefindexService,
    config: ConfigService,
  ) {
    this.networkPassphrase = config.getOrThrow<string>(
      'STELLAR_NETWORK_PASSPHRASE',
    );
  }

  async createVault(dto: CreateManagedVaultDto) {
    const result = await this.defindex.createVault({
      caller: dto.callerAddress,
      roles: dto.roles,
      name: dto.name,
      symbol: dto.symbol,
      vaultFee: dto.vaultFeeBps,
      upgradable: dto.upgradable ?? true,
      assets: dto.assets.map(({ address, symbol, amount, strategies }) => ({
        address,
        symbol,
        amount,
        strategies,
      })),
    });

    const managed = await this.prisma.managedVault.create({
      data: {
        creatorUserId: dto.userId,
        callerAddress: dto.callerAddress,
        name: dto.name,
        symbol: dto.symbol,
        description: dto.description,
        vaultFeeBps: dto.vaultFeeBps,
        // Prisma accepts these DTOs as JSON at runtime, while its generated
        // input type requires the explicit object boundary for class instances.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        roles: dto.roles as object,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
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

    // Fixa o XDR assinado contra o que o servidor gerou, como
    // `StellarService.buildSponsoredFeeBumpXdr` faz nos outros fluxos de
    // submissao: so a transacao desta criacao de vault pode ser submetida aqui.
    // O hash cobre source account, operacoes, sequence e timebounds, logo
    // qualquer alteracao quebra a comparacao.
    this.assertSignedXdrMatches(dto.signedXdr, managed.unsignedXdr);

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
    const assetsJson = managed.assets as Array<{
      symbol?: string;
      decimals?: number;
    }>;
    const assetSymbol = assetsJson?.[0]?.symbol ?? 'UNKNOWN';
    const assetDecimals = assetsJson?.[0]?.decimals ?? 7;

    let vaultCatalogId: string | undefined;
    if (vaultAddress) {
      // The `as never` input workaround widens Prisma's inferred return type.
      // Keep the selected result explicit until that legacy call is typed.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      const catalog = (await this.prisma.vaultCatalog.upsert({
        where: { defindexVaultId: vaultAddress },
        create: {
          defindexVaultId: vaultAddress,
          name: managed.name,
          description: managed.description,
          assetSymbol,
          assetDecimals,
          isActive: true,
          lastSyncedAt: new Date(),
        },
        update: {
          name: managed.name,
          description: managed.description ?? undefined,
          assetSymbol,
          assetDecimals,
          isActive: true,
        },
        select: { id: true },
      } as never)) as { id: string };
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

  /**
   * Mesma comparacao de `StellarService.buildSponsoredFeeBumpXdr`: o hash da
   * transacao cobre source account, operacoes, sequence e timebounds, entao
   * basta compara-lo com o da transacao que o servidor gerou.
   */
  private assertSignedXdrMatches(
    signedXdr: string,
    expectedUnsignedXdr: string | null,
  ) {
    if (!expectedUnsignedXdr) {
      throw new BadRequestException(
        'Vault has no generated transaction to match against',
      );
    }

    let signedTx: Transaction;
    try {
      signedTx = new Transaction(signedXdr, this.networkPassphrase);
    } catch {
      throw new BadRequestException('Invalid signed transaction XDR');
    }

    if (signedTx.signatures.length === 0) {
      throw new BadRequestException('Transaction must be signed by the caller');
    }

    let expectedTx: Transaction;
    try {
      expectedTx = new Transaction(expectedUnsignedXdr, this.networkPassphrase);
    } catch {
      throw new BadRequestException(
        'Stored unsigned transaction XDR is invalid',
      );
    }

    // `Transaction.hash()` devolve Uint8Array no stellar-sdk 17, que nao tem
    // `.equals`; Buffer mantem a comparacao byte a byte nas duas versoes.
    if (!Buffer.from(signedTx.hash()).equals(Buffer.from(expectedTx.hash()))) {
      throw new BadRequestException(
        'Signed transaction does not match the generated transaction',
      );
    }
  }
}
