import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { StellarService } from '../wallets/stellar.service';

export function normalizeUsername(value: string): string | null {
  // Only ASCII letters are case-folded; do not silently accept whitespace or Unicode aliases.
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
    if (!username) return { available: false, reason: 'USERNAME_INVALID' };
    const found = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    return { available: !found, reason: found ? 'USERNAME_TAKEN' : null };
  }

  async register(userId: string, value: string) {
    const username = normalizeUsername(value);
    if (!username) throw new BadRequestException({ code: 'USERNAME_INVALID' });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.updateMany({
          where: { id: userId, username: null, deletedAt: null },
          data: { username },
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
    if (!username) throw new BadRequestException({ code: 'USERNAME_INVALID' });
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        deletedAt: true,
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
    if (!user || user.deletedAt || !user.wallets[0])
      throw new NotFoundException('Username not found');
    const stellarAddress = user.wallets[0].stellarAddress;
    const verified =
      !!user.blindpayReceiver &&
      ['APPROVED', 'APPROVED_RFI'].includes(user.blindpayReceiver.kycStatus);
    return {
      username: user.username,
      name: verified ? user.blindpayReceiver!.name : null,
      verified,
      stellarAddress,
      canReceive: await this.stellar.getReceivingCapabilities(stellarAddress),
    };
  }
}
