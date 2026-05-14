import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { WalletLoginDto } from './dto/wallet-login.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find or create a User identified by their Stellar wallet address.
   * If the wallet is new, a fresh User record is also created.
   * If the wallet already exists, the associated user is returned.
   */
  async walletLogin(dto: WalletLoginDto) {
    const { stellarAddress, label } = dto;

    // Check if wallet already exists
    const existingWallet = await this.prisma.walletAccount.findFirst({
      where: { stellarAddress, isActive: true },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true, createdAt: true },
        },
      },
    });

    if (existingWallet) {
      this.logger.log(`Wallet login: existing user ${existingWallet.userId}`);
      return {
        user: existingWallet.user,
        wallet: {
          id: existingWallet.id,
          stellarAddress: existingWallet.stellarAddress,
          label: existingWallet.label,
          isActive: existingWallet.isActive,
        },
        isNewUser: false,
      };
    }

    // Create new user + wallet in a single transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: {} });

      const wallet = await tx.walletAccount.create({
        data: {
          userId: user.id,
          stellarAddress,
          label: label ?? null,
        },
      });

      return { user, wallet };
    });

    this.logger.log(`Wallet login: new user ${result.user.id} created`);
    return {
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        avatarUrl: result.user.avatarUrl,
        createdAt: result.user.createdAt,
      },
      wallet: {
        id: result.wallet.id,
        stellarAddress: result.wallet.stellarAddress,
        label: result.wallet.label,
        isActive: result.wallet.isActive,
      },
      isNewUser: true,
    };
  }
}
