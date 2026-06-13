import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { StellarService } from './stellar.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import {
  ActivateWalletDto,
  SubmitActivationDto,
} from './dto/activate-wallet.dto';

const ACTIVATION_XDR_TTL_MS = 9 * 60 * 1000;
const ACTIVATION_TRANSACTION_TIMEOUT_MS = 30_000;

type ActivationSubmissionResult =
  | { success: true; txHash: string }
  | { success: false; error: unknown };

const walletSelect = {
  id: true,
  userId: true,
  stellarAddress: true,
  label: true,
  isActive: true,
  isActivated: true,
  createdAt: true,
};

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellarService: StellarService,
  ) {}

  async listWallets(userId: string) {
    return this.prisma.walletAccount.findMany({
      where: { userId, isActive: true },
      select: walletSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async createWallet(dto: CreateWalletDto) {
    // Ensure user exists
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException(`User ${dto.userId} not found`);

    // Prevent duplicate wallet (stellarAddress is globally unique)
    const existing = await this.prisma.walletAccount.findUnique({
      where: { stellarAddress: dto.stellarAddress },
      select: { id: true, userId: true, isActive: true },
    });

    if (existing) {
      if (existing.userId !== dto.userId) {
        throw new ConflictException(
          `Wallet ${dto.stellarAddress} is already registered to another user`,
        );
      }
      if (existing.isActive) {
        throw new ConflictException(
          `Wallet ${dto.stellarAddress} already registered for user ${dto.userId}`,
        );
      }
      // Re-activate deactivated wallet
      const reactivated = await this.prisma.walletAccount.update({
        where: { id: existing.id },
        data: { isActive: true, label: dto.label ?? null },
        select: walletSelect,
      });
      this.logger.log(
        `Wallet ${existing.id} re-activated for user ${dto.userId}`,
      );
      return reactivated;
    }

    const wallet = await this.prisma.walletAccount.create({
      data: {
        userId: dto.userId,
        stellarAddress: dto.stellarAddress,
        label: dto.label ?? null,
      },
      select: walletSelect,
    });

    this.logger.log(`Wallet ${wallet.id} created for user ${dto.userId}`);
    return wallet;
  }

  async getWallet(id: string) {
    const wallet = await this.prisma.walletAccount.findUnique({
      where: { id },
      select: walletSelect,
    });
    if (!wallet) throw new NotFoundException(`Wallet ${id} not found`);
    return wallet;
  }

  async removeWallet(id: string) {
    const wallet = await this.prisma.walletAccount.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!wallet) throw new NotFoundException(`Wallet ${id} not found`);

    await this.prisma.walletAccount.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.log(`Wallet ${id} deactivated`);
    return { id, isActive: false };
  }

  async activateWallet(dto: ActivateWalletDto) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'wallet-activation:' + dto.walletAccountId}))`;

        const wallet = await tx.walletAccount.findUnique({
          where: { id: dto.walletAccountId },
          select: {
            id: true,
            userId: true,
            stellarAddress: true,
            isActivated: true,
            activationUnsignedXdr: true,
            activationExpiresAt: true,
          },
        });

        if (!wallet) {
          throw new NotFoundException(
            `Wallet ${dto.walletAccountId} not found`,
          );
        }
        if (wallet.userId !== dto.userId) {
          throw new NotFoundException(
            `Wallet ${dto.walletAccountId} not found for user ${dto.userId}`,
          );
        }
        if (wallet.stellarAddress !== dto.stellarAddress) {
          throw new NotFoundException(
            `Wallet ${dto.walletAccountId} does not match address ${dto.stellarAddress}`,
          );
        }
        if (wallet.isActivated) {
          throw new ConflictException(
            `Wallet ${dto.walletAccountId} is already activated`,
          );
        }

        if (
          wallet.activationUnsignedXdr &&
          wallet.activationExpiresAt &&
          wallet.activationExpiresAt.getTime() > Date.now()
        ) {
          this.logger.log(
            `Reusing pending activation XDR for wallet ${dto.walletAccountId}`,
          );
          return { unsignedXdr: wallet.activationUnsignedXdr };
        }

        const unsignedXdr = await this.stellarService.buildActivationXdr(
          dto.stellarAddress,
        );
        const activationExpiresAt = new Date(
          Date.now() + ACTIVATION_XDR_TTL_MS,
        );

        await tx.walletAccount.update({
          where: { id: dto.walletAccountId },
          data: {
            activationStatus: 'PENDING_SIGNATURE',
            activationUnsignedXdr: unsignedXdr,
            activationExpiresAt,
            activationErrorMessage: null,
          },
        });

        this.logger.log(
          `Activation XDR generated for wallet ${dto.walletAccountId}`,
        );
        return { unsignedXdr };
      },
      { timeout: ACTIVATION_TRANSACTION_TIMEOUT_MS },
    );
  }

  async submitActivation(dto: SubmitActivationDto) {
    const result = await this.prisma.$transaction<ActivationSubmissionResult>(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'wallet-activation:' + dto.walletAccountId}))`;

        const wallet = await tx.walletAccount.findUnique({
          where: { id: dto.walletAccountId },
          select: {
            id: true,
            stellarAddress: true,
            isActivated: true,
            activationUnsignedXdr: true,
            activationTxHash: true,
          },
        });

        if (!wallet) {
          throw new NotFoundException(
            `Wallet ${dto.walletAccountId} not found`,
          );
        }
        if (wallet.isActivated) {
          this.logger.log(
            `Activation submission reused for activated wallet ${dto.walletAccountId}`,
          );
          return {
            success: true,
            txHash: wallet.activationTxHash ?? '',
          };
        }
        if (!wallet.activationUnsignedXdr) {
          throw new ConflictException(
            `Wallet ${dto.walletAccountId} has no pending activation`,
          );
        }

        await tx.walletAccount.update({
          where: { id: dto.walletAccountId },
          data: {
            activationStatus: 'SUBMITTING',
            activationErrorMessage: null,
          },
        });

        try {
          const { hash } = await this.stellarService.submitFeeBumpTransaction(
            dto.signedXdr,
            wallet.activationUnsignedXdr,
          );

          await tx.walletAccount.update({
            where: { id: dto.walletAccountId },
            data: {
              isActivated: true,
              activationStatus: 'ACTIVATED',
              activationTxHash: hash,
              activationUnsignedXdr: null,
              activationExpiresAt: null,
              activationErrorMessage: null,
            },
          });

          this.logger.log(
            `Wallet ${dto.walletAccountId} activated, tx: ${hash}`,
          );
          return { success: true, txHash: hash };
        } catch (error: any) {
          const activatedOnChain = await this.stellarService.isAccountActivated(
            wallet.stellarAddress,
          );

          if (activatedOnChain) {
            await tx.walletAccount.update({
              where: { id: dto.walletAccountId },
              data: {
                isActivated: true,
                activationStatus: 'ACTIVATED',
                activationUnsignedXdr: null,
                activationExpiresAt: null,
                activationErrorMessage: null,
              },
            });
            this.logger.warn(
              `Wallet ${dto.walletAccountId} reconciled as activated after submission error`,
            );
            return { success: true, txHash: '' };
          }

          await tx.walletAccount.update({
            where: { id: dto.walletAccountId },
            data: {
              activationStatus: 'FAILED',
              activationErrorMessage:
                error?.message ?? 'Activation transaction failed',
            },
          });
          return { success: false, error };
        }
      },
      { timeout: ACTIVATION_TRANSACTION_TIMEOUT_MS },
    );

    if (!result.success) throw result.error;
    return result;
  }
}
