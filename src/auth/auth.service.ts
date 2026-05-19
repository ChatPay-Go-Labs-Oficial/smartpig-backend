import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { PrismaService } from '../infra/prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WalletLoginDto } from './dto/wallet-login.dto';

const NONCE_TTL_SECONDS = 300; // 5 minutes
const REFRESH_TOKEN_BYTES = 48;

const userSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  createdAt: true,
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async generateChallenge(address: string) {
    const nonce = randomBytes(32).toString('hex');
    const message = `SmartPig login: ${nonce}`;

    await this.redis.setNonce(address, nonce, NONCE_TTL_SECONDS);
    this.logger.log(`Challenge generated for ${address}`);

    return { nonce, message };
  }

  async walletLogin(dto: WalletLoginDto) {
    const { signerPublicKey, signature, smartAccountAddress } = dto;

    // The nonce is keyed by the identity being authenticated:
    // - Regular wallet: the wallet address (G...)
    // - Smart account: the signer public key (G...) — whoever is signing
    const nonce = await this.redis.getAndDeleteNonce(signerPublicKey);
    if (!nonce) {
      throw new UnauthorizedException(
        'Challenge expired or not found. Request a new challenge.',
      );
    }

    const message = `SmartPig login: ${nonce}`;
    const verified = this.verifyEd25519(signerPublicKey, message, signature);
    if (!verified) {
      throw new UnauthorizedException('Invalid signature');
    }

    const { user, wallet, isNewUser } = await this.findOrCreateUser(
      signerPublicKey,
      smartAccountAddress ?? null,
    );

    const payload = {
      sub: user.id,
      wallet: smartAccountAddress ?? signerPublicKey,
    };
    const accessToken = this.jwtService.sign(payload);

    const refreshTokenRaw = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const refreshTokenHash = createHash('sha256')
      .update(refreshTokenRaw)
      .digest('hex');
    const refreshExpiration = this.config.get<number>(
      'JWT_REFRESH_EXPIRATION',
      2592000,
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        expiresAt: new Date(Date.now() + refreshExpiration * 1000),
      },
    });

    this.logger.log(
      `User ${user.id} logged in via ${smartAccountAddress ? `smart account ${smartAccountAddress}` : `wallet ${signerPublicKey}`}`,
    );
    return {
      accessToken,
      refreshToken: refreshTokenRaw,
      user,
      wallet,
      isNewUser,
    };
  }

  async refreshTokens(refreshTokenRaw: string) {
    const tokenHash = createHash('sha256')
      .update(refreshTokenRaw)
      .digest('hex');

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: userSelect } },
    });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const payload = { sub: stored.userId, wallet: '' };
    const accessToken = this.jwtService.sign(payload);

    const newRefreshTokenRaw = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const newRefreshTokenHash = createHash('sha256')
      .update(newRefreshTokenRaw)
      .digest('hex');
    const refreshExpiration = this.config.get<number>(
      'JWT_REFRESH_EXPIRATION',
      2592000,
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: newRefreshTokenHash,
        expiresAt: new Date(Date.now() + refreshExpiration * 1000),
      },
    });

    this.logger.log(`Refresh token rotated for user ${stored.userId}`);
    return { accessToken, refreshToken: newRefreshTokenRaw };
  }

  async logout(refreshTokenRaw: string) {
    const tokenHash = createHash('sha256')
      .update(refreshTokenRaw)
      .digest('hex');

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true },
    });

    if (!stored) {
      return { revoked: true };
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    this.logger.log(`Refresh token revoked`);
    return { revoked: true };
  }

  // ─── Legacy (deprecated, no JWT) ─────────────────────────────────────────

  async walletLoginLegacy(address: string) {
    const { user, wallet, isNewUser } = await this.findOrCreateUser(
      address,
      null,
    );

    return { user, wallet, isNewUser };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private verifyEd25519(
    publicKey: string,
    message: string,
    signatureBase64: string,
  ): boolean {
    try {
      const keypair = Keypair.fromPublicKey(publicKey);
      const sigBuffer = Buffer.from(signatureBase64, 'base64');
      const msgBuffer = Buffer.from(message);
      return keypair.verify(msgBuffer, sigBuffer);
    } catch {
      return false;
    }
  }

  private async findOrCreateUser(
    signerPublicKey: string,
    smartAccountAddress: string | null,
  ) {
    const existingWallet = await this.prisma.walletAccount.findFirst({
      where: { stellarAddress: signerPublicKey, isActive: true },
      include: { user: { select: userSelect } },
    });

    if (existingWallet) {
      return {
        user: existingWallet.user,
        wallet: {
          id: existingWallet.id,
          stellarAddress: existingWallet.stellarAddress,
          smartAccountAddress: existingWallet.smartAccountAddress,
          label: existingWallet.label,
          isActive: existingWallet.isActive,
        },
        isNewUser: false,
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: {} });
      const wallet = await tx.walletAccount.create({
        data: {
          userId: user.id,
          stellarAddress: signerPublicKey,
          smartAccountAddress,
        },
      });
      const createdUser = await tx.user.findUnique({
        where: { id: user.id },
        select: userSelect,
      });
      return { user: createdUser!, wallet };
    });

    this.logger.log(`New user ${result.user.id} created`);
    return {
      user: result.user,
      wallet: {
        id: result.wallet.id,
        stellarAddress: result.wallet.stellarAddress,
        smartAccountAddress: result.wallet.smartAccountAddress,
        label: result.wallet.label,
        isActive: result.wallet.isActive,
      },
      isNewUser: true,
    };
  }
}
