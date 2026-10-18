import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TrustlineStatus } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { StellarService, TX_TIMEOUT_SECONDS } from './stellar.service';
import { assetIdOf } from '../config/asset-registry';

/**
 * How long an issued trustline XDR stays usable.
 *
 * Shorter than the transaction's own 600s time bound, so a cached XDR is never
 * handed out close enough to expiry that the user's signature arrives too late.
 */
const TRUSTLINE_XDR_TTL_MS = (TX_TIMEOUT_SECONDS - 60) * 1000;

@Injectable()
export class TrustlinesService {
  private readonly logger = new Logger(TrustlinesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
  ) {}

  /**
   * Whether this wallet needs a trustline for an asset, and the XDR if so.
   *
   * Returns `required: false` rather than throwing when the line already exists:
   * the deposit flow calls this before every deposit into a non-funding asset, and
   * "already done" is the normal answer, not an error.
   *
   * Horizon is the authority. The local row is a cache and an audit trail, so a
   * trustline opened by another client is recognised rather than offered again.
   */
  async ensureTrustline(params: {
    userId: string;
    walletAccountId: string;
    assetSymbol: string;
  }): Promise<{
    required: boolean;
    assetId: string;
    unsignedXdr: string | null;
    expiresAt: Date | null;
  }> {
    const { userId, walletAccountId, assetSymbol } = params;

    const definition = this.stellar.getAsset(assetSymbol);
    const assetId = assetIdOf(definition);

    const wallet = await this.prisma.walletAccount.findFirst({
      where: { id: walletAccountId, userId, isActive: true },
      select: { id: true, stellarAddress: true, isActivated: true },
    });
    if (!wallet) {
      throw new NotFoundException(
        `Wallet ${walletAccountId} not found for user ${userId}`,
      );
    }

    // The native asset has no trustline to open.
    if (definition.kind === 'NATIVE') {
      return { required: false, assetId, unsignedXdr: null, expiresAt: null };
    }

    if (!wallet.isActivated) {
      throw new ConflictException({
        message:
          'The wallet must be activated before a trustline can be added to it',
        code: 'WALLET_NOT_ACTIVATED',
        details: { walletAccountId },
      });
    }

    if (await this.stellar.hasTrustline(wallet.stellarAddress, definition)) {
      // Record it, so a line opened elsewhere stops costing a Horizon read.
      await this.markActive(wallet.id, assetId, definition.symbol, null);
      return { required: false, assetId, unsignedXdr: null, expiresAt: null };
    }

    const existing = await this.prisma.walletTrustline.findUnique({
      where: {
        walletAccountId_assetId: { walletAccountId: wallet.id, assetId },
      },
      select: { unsignedXdr: true, expiresAt: true, status: true },
    });

    // Reuse an XDR that is still comfortably within its time bound, so a retry
    // does not strand the previous one.
    if (
      existing?.status === TrustlineStatus.PENDING_SIGNATURE &&
      existing.unsignedXdr &&
      existing.expiresAt &&
      existing.expiresAt > new Date()
    ) {
      return {
        required: true,
        assetId,
        unsignedXdr: existing.unsignedXdr,
        expiresAt: existing.expiresAt,
      };
    }

    const unsignedXdr = await this.stellar.buildSponsoredTrustlineXdr(
      wallet.stellarAddress,
      definition,
    );
    const expiresAt = new Date(Date.now() + TRUSTLINE_XDR_TTL_MS);

    await this.prisma.walletTrustline.upsert({
      where: {
        walletAccountId_assetId: { walletAccountId: wallet.id, assetId },
      },
      create: {
        walletAccountId: wallet.id,
        assetId,
        assetSymbol: definition.symbol,
        status: TrustlineStatus.PENDING_SIGNATURE,
        unsignedXdr,
        expiresAt,
      },
      update: {
        status: TrustlineStatus.PENDING_SIGNATURE,
        unsignedXdr,
        expiresAt,
        errorMessage: null,
      },
    });

    this.logger.log(
      `Trustline XDR issued for wallet=${wallet.id} asset=${assetId}`,
    );

    return { required: true, assetId, unsignedXdr, expiresAt };
  }

  /**
   * Submits the user-signed trustline transaction.
   *
   * Goes through `submitFeeBumpTransaction` with the stored XDR, which pins the
   * hash — the client may only add a signature, never change the operation.
   */
  async submitTrustline(params: {
    userId: string;
    walletAccountId: string;
    assetSymbol: string;
    signedXdr: string;
  }): Promise<{ assetId: string; txHash: string; status: TrustlineStatus }> {
    const { userId, walletAccountId, assetSymbol, signedXdr } = params;

    const definition = this.stellar.getAsset(assetSymbol);
    const assetId = assetIdOf(definition);

    const wallet = await this.prisma.walletAccount.findFirst({
      where: { id: walletAccountId, userId, isActive: true },
      select: { id: true, stellarAddress: true },
    });
    if (!wallet) {
      throw new NotFoundException(
        `Wallet ${walletAccountId} not found for user ${userId}`,
      );
    }

    const row = await this.prisma.walletTrustline.findUnique({
      where: {
        walletAccountId_assetId: { walletAccountId: wallet.id, assetId },
      },
      select: { id: true, status: true, unsignedXdr: true, txHash: true },
    });

    if (!row?.unsignedXdr) {
      throw new BadRequestException(
        `No trustline transaction was issued for ${assetId} on this wallet`,
      );
    }

    // Idempotent: a repeated submit returns the hash we already have rather than
    // replaying a transaction that landed.
    if (row.status === TrustlineStatus.ACTIVE && row.txHash) {
      return { assetId, txHash: row.txHash, status: row.status };
    }

    try {
      const { hash } = await this.stellar.submitFeeBumpTransaction(
        signedXdr,
        row.unsignedXdr,
      );
      await this.markActive(wallet.id, assetId, definition.symbol, hash);

      this.logger.log(
        `Trustline active for wallet=${wallet.id} asset=${assetId} tx=${hash}`,
      );
      return { assetId, txHash: hash, status: TrustlineStatus.ACTIVE };
    } catch (err) {
      const message = (err as Error).message;

      // Horizon may reject because the line already exists — which is success as
      // far as the caller is concerned.
      if (await this.stellar.hasTrustline(wallet.stellarAddress, definition)) {
        await this.markActive(wallet.id, assetId, definition.symbol, null);
        return {
          assetId,
          txHash: row.txHash ?? '',
          status: TrustlineStatus.ACTIVE,
        };
      }

      await this.prisma.walletTrustline.update({
        where: { id: row.id },
        data: { status: TrustlineStatus.FAILED, errorMessage: message },
      });
      throw err;
    }
  }

  /** The trustlines recorded for a wallet. */
  async listTrustlines(userId: string, walletAccountId: string) {
    const wallet = await this.prisma.walletAccount.findFirst({
      where: { id: walletAccountId, userId, isActive: true },
      select: { id: true },
    });
    if (!wallet) {
      throw new NotFoundException(
        `Wallet ${walletAccountId} not found for user ${userId}`,
      );
    }

    return this.prisma.walletTrustline.findMany({
      where: { walletAccountId: wallet.id },
      select: {
        assetId: true,
        assetSymbol: true,
        status: true,
        txHash: true,
        updatedAt: true,
      },
      orderBy: { assetSymbol: 'asc' },
    });
  }

  private async markActive(
    walletAccountId: string,
    assetId: string,
    assetSymbol: string,
    txHash: string | null,
  ) {
    await this.prisma.walletTrustline.upsert({
      where: { walletAccountId_assetId: { walletAccountId, assetId } },
      create: {
        walletAccountId,
        assetId,
        assetSymbol,
        status: TrustlineStatus.ACTIVE,
        txHash,
      },
      update: {
        status: TrustlineStatus.ACTIVE,
        // Clear the issued XDR: it is spent, and keeping it invites a replay.
        unsignedXdr: null,
        expiresAt: null,
        errorMessage: null,
        ...(txHash ? { txHash } : {}),
      },
    });
  }
}
