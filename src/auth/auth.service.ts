import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
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
  async walletLogin(dto: WalletLoginDto, verifiedStellarAddresses?: string[]) {
    const { stellarAddress, label } = dto;
    const isAuthenticated = verifiedStellarAddresses !== undefined;
    const candidateAddresses = Array.from(
      new Set(verifiedStellarAddresses ?? [stellarAddress]),
    );

    if (!candidateAddresses.includes(stellarAddress)) {
      throw new ConflictException(
        'The submitted Stellar wallet is not linked to the authenticated Privy user',
      );
    }

    // Recover the original account when Privy has more than one Stellar wallet.
    // The oldest registered candidate is the wallet the user first used here.
    const existingWallet = await this.prisma.walletAccount.findFirst({
      where: {
        stellarAddress: { in: candidateAddresses },
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            experienceMode: true,
            experienceModeUpdatedAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (existingWallet) {
      // Recuperar uma conta existente exige token; criar uma nova (abaixo) não.
      // Sem token, `candidateAddresses` é apenas o endereço do próprio body, e a
      // checagem acima compara o valor consigo mesmo — não estabelece posse. Uma
      // chave pública Stellar fica on-chain e circula em gifts, então conhecê-la
      // não é evidência de nada.
      if (!isAuthenticated) {
        throw new UnauthorizedException(
          'This Stellar wallet is already registered — authenticate to continue',
        );
      }

      this.logger.log(`Wallet login: existing user ${existingWallet.userId}`);
      return {
        user: {
          ...existingWallet.user,
          // Legacy rows are intentionally PRO until the person opts into Lite.
          experienceMode: existingWallet.user.experienceMode ?? 'PRO',
        },
        wallet: {
          id: existingWallet.id,
          stellarAddress: existingWallet.stellarAddress,
          label: existingWallet.label,
          isActive: existingWallet.isActive,
        },
        isNewUser: false,
        needsActivation: !existingWallet.isActivated,
      };
    }

    // Create new user + wallet in a single transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Existing rows use null => effective PRO for compatibility. Writing LITE
      // explicitly here makes only genuinely new accounts enter the new journey.
      const user = await tx.user.create({
        data: {
          experienceMode: 'LITE',
          experienceModeUpdatedAt: new Date(),
        },
      });

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
        experienceMode: result.user.experienceMode ?? 'LITE',
        experienceModeUpdatedAt: result.user.experienceModeUpdatedAt,
        createdAt: result.user.createdAt,
      },
      wallet: {
        id: result.wallet.id,
        stellarAddress: result.wallet.stellarAddress,
        label: result.wallet.label,
        isActive: result.wallet.isActive,
      },
      isNewUser: true,
      needsActivation: true,
    };
  }
}
