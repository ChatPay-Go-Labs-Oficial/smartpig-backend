import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { StellarService } from '../wallets/stellar.service';

const USERNAME_PATTERN = /^[a-z][a-z0-9._]{2,19}$/;

@Injectable()
export class UsernamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
  ) {}

  async availability(rawUsername: string) {
    const username = this.normalize(rawUsername);
    if (!USERNAME_PATTERN.test(username)) {
      return { available: false, reason: 'INVALID' as const };
    }
    const existing = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    return existing
      ? { available: false, reason: 'TAKEN' as const }
      : { available: true };
  }

  async create(userId: string, rawUsername: string) {
    const username = this.normalize(rawUsername);
    if (!USERNAME_PATTERN.test(username)) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        code: 'USERNAME_INVALID',
        message:
          'Username must have 3 to 20 characters, start with a letter and use only lowercase letters, numbers, dots or underscores.',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    if (user.username) {
      throw new ConflictException({
        statusCode: 409,
        code: 'USERNAME_ALREADY_SET',
        message: 'Username is permanent and has already been set.',
      });
    }

    try {
      const updated = await this.prisma.user.updateMany({
        where: { id: userId, username: null },
        data: { username, usernameSetAt: new Date() },
      });
      if (updated.count === 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'USERNAME_ALREADY_SET',
          message: 'Username is permanent and has already been set.',
        });
      }
      return { username };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          statusCode: 409,
          code: 'USERNAME_TAKEN',
          message: 'Username is already in use.',
        });
      }
      throw error;
    }
  }

  async resolve(rawUsername: string) {
    const username = this.normalize(rawUsername);
    if (!USERNAME_PATTERN.test(username)) this.notFound();

    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        name: true,
        deletedAt: true,
        blindpayReceiver: { select: { name: true, kycStatus: true } },
        etherfuseCustomer: { select: { kycStatus: true } },
        wallets: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { stellarAddress: true },
        },
      },
    });
    const wallet = user?.wallets[0];
    if (!user || user.deletedAt || !wallet) this.notFound();

    const blindPayVerified = ['APPROVED', 'APPROVED_RFI'].includes(
      user.blindpayReceiver?.kycStatus ?? '',
    );
    const etherfuseVerified = user.etherfuseCustomer?.kycStatus === 'APPROVED';
    const verified = blindPayVerified || etherfuseVerified;
    const [usdc, eurc] = await Promise.all([
      this.receives(wallet.stellarAddress, 'USDC'),
      this.receives(wallet.stellarAddress, 'EURC'),
    ]);

    return {
      username,
      displayName: verified
        ? (user.blindpayReceiver?.name ?? user.name ?? 'Usuário PigFi')
        : 'Usuário PigFi',
      verified,
      stellarAddress: wallet.stellarAddress,
      receives: { USDC: usdc, EURC: eurc, XLM: true },
    };
  }

  private async receives(address: string, symbol: string): Promise<boolean> {
    try {
      return await this.stellar.hasTrustline(
        address,
        this.stellar.getAsset(symbol),
      );
    } catch {
      return false;
    }
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase();
  }

  private notFound(): never {
    throw new NotFoundException({
      statusCode: 404,
      code: 'USERNAME_NOT_FOUND',
      message: 'Username not found.',
    });
  }
}
