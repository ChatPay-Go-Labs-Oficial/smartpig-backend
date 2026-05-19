import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../infra/prisma/prisma.service';
import { DefindexService } from '../defindex/defindex.service';

/**
 * Takes a daily snapshot of each user's vault balance.
 * Runs at 00:05 UTC every day.
 */
@Injectable()
export class PortfolioSnapshotJob {
  private readonly logger = new Logger(PortfolioSnapshotJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly defindex: DefindexService,
  ) {}

  @Cron('5 0 * * *', { timeZone: 'UTC' })
  async takeSnapshots() {
    // Find all users that have at least one active wallet and have done deposits
    const wallets = await this.prisma.walletAccount.findMany({
      where: { isActive: true },
      select: { userId: true, stellarAddress: true },
      distinct: ['userId'],
    });

    const vaults = await this.prisma.vaultCatalog.findMany({
      where: { isActive: true },
      select: { id: true, defindexVaultId: true },
    });

    if (wallets.length === 0 || vaults.length === 0) return;

    this.logger.log(
      `Taking portfolio snapshots: ${wallets.length} wallets × ${vaults.length} vaults`,
    );

    const capturedAt = new Date();
    let snapshots = 0;

    for (const wallet of wallets) {
      for (const vault of vaults) {
        try {
          const balance = await this.defindex.getVaultBalance(
            vault.defindexVaultId,
            wallet.stellarAddress,
          );

          // Only persist if user has a non-zero balance
          if (balance.dfTokens <= 0) continue;

          await this.prisma.portfolioSnapshot.create({
            data: {
              userId: wallet.userId,
              vaultId: vault.id,
              balanceAmount: new Decimal(balance.dfTokens),
              capturedAt,
            },
          });
          snapshots++;
        } catch (err) {
          this.logger.warn(
            `Snapshot failed for wallet=${wallet.stellarAddress} vault=${vault.defindexVaultId}: ${(err as Error).message}`,
          );
        }
      }
    }

    this.logger.log(
      `Portfolio snapshot complete: ${snapshots} record(s) created`,
    );
  }
}
