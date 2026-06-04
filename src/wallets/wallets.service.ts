import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { StellarService } from './stellar.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { ActivateWalletDto, SubmitActivationDto } from './dto/activate-wallet.dto';

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
      this.logger.log(`Wallet ${existing.id} re-activated for user ${dto.userId}`);
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
    const wallet = await this.prisma.walletAccount.findUnique({
      where: { id: dto.walletAccountId },
      select: { id: true, userId: true, stellarAddress: true, isActivated: true },
    });

    if (!wallet) throw new NotFoundException(`Wallet ${dto.walletAccountId} not found`);
    if (wallet.userId !== dto.userId) {
      throw new NotFoundException(`Wallet ${dto.walletAccountId} not found for user ${dto.userId}`);
    }
    if (wallet.isActivated) {
      throw new ConflictException(`Wallet ${dto.walletAccountId} is already activated`);
    }

    const unsignedXdr = await this.stellarService.buildActivationXdr(dto.stellarAddress);

    this.logger.log(`Activation XDR generated for wallet ${dto.walletAccountId}`);
    return { unsignedXdr };
  }

  async submitActivation(dto: SubmitActivationDto) {
    const wallet = await this.prisma.walletAccount.findUnique({
      where: { id: dto.walletAccountId },
      select: { id: true, isActivated: true },
    });

    if (!wallet) throw new NotFoundException(`Wallet ${dto.walletAccountId} not found`);
    if (wallet.isActivated) {
      throw new ConflictException(`Wallet ${dto.walletAccountId} is already activated`);
    }

    const { hash } = await this.stellarService.submitFeeBumpTransaction(dto.signedXdr);

    await this.prisma.walletAccount.update({
      where: { id: dto.walletAccountId },
      data: { isActivated: true },
    });

    this.logger.log(`Wallet ${dto.walletAccountId} activated, tx: ${hash}`);
    return { success: true, txHash: hash };
  }
}
