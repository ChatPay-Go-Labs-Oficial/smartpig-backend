import {
  UnprocessableEntityException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { StellarService } from '../wallets/stellar.service';

export function normalizeUsername(value: string): string | null {
  value = value.trim();
  // Accept only ASCII usernames after trimming, never Unicode aliases.
  if (!/^[a-zA-Z][a-zA-Z0-9._]{2,19}$/.test(value)) return null;
  return value.toLowerCase();
}

@Injectable()
export class UsernamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
  ) {}

  async availability(value: string) {
    const username = normalizeUsername(value);
    if (!username) return { available: false, reason: 'INVALID' };
    const found = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    return found ? { available: false, reason: 'TAKEN' } : { available: true };
  }

  async register(userId: string, value: string) {
    const username = normalizeUsername(value);
    if (!username)
      throw new UnprocessableEntityException({
        code: 'USERNAME_INVALID',
        statusCode: 422,
      });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.updateMany({
          where: { id: userId, username: null, deletedAt: null },
          data: { username, usernameSetAt: new Date() },
        });
        if (!updated.count)
          throw new ConflictException({ code: 'USERNAME_ALREADY_SET' });
        return { username };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({ code: 'USERNAME_TAKEN' });
      }
      throw error;
    }
  }

  async resolve(value: string) {
    const username = normalizeUsername(value);
    if (!username) this.notFound();
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        name: true,
        deletedAt: true,
        etherfuseCustomer: { select: { kycStatus: true } },
        username: true,
        blindpayReceiver: { select: { name: true, kycStatus: true } },
        wallets: {
          where: { isActive: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { stellarAddress: true },
        },
      },
    });
    if (!user || user.deletedAt || !user.wallets[0]) this.notFound();
    const stellarAddress = user.wallets[0].stellarAddress;
    const blindPayVerified =
      !!user.blindpayReceiver &&
      ['APPROVED', 'APPROVED_RFI'].includes(user.blindpayReceiver.kycStatus);
    const verified =
      blindPayVerified || user.etherfuseCustomer?.kycStatus === 'APPROVED';
    const name = blindPayVerified
      ? user.blindpayReceiver!.name
      : verified
        ? user.name
        : null;
    const receives =
      await this.stellar.getReceivingCapabilities(stellarAddress);
    return {
      username,
      displayName: name ?? 'Usuário PigFi',
      name,
      receives,
      verified,
      stellarAddress,
      canReceive: receives,
    };
  }

  private notFound(): never {
    throw new NotFoundException({
      statusCode: 404,
      code: 'USERNAME_NOT_FOUND',
      message: 'Username not found.',
    });
  }
}
