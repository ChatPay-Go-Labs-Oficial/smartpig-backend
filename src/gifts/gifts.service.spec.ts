import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { GiftStatus } from '@prisma/client';
import { GiftsService } from './gifts.service';
import { GiftStellarService } from './gift-stellar.service';
import { PrismaService } from '../infra/prisma/prisma.service';

const config = {
  get: (key: string) =>
    ({
      GIFT_MIN_USD: 1,
      GIFT_MAX_USD: 100,
      GIFT_EXPIRY_DAYS: 7,
      GIFT_MAX_PENDING_PER_USER: 5,
    })[key],
} as unknown as ConfigService;

describe('GiftsService', () => {
  it('rejects amounts above the configured maximum', async () => {
    const prisma = {
      gift: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    } as unknown as PrismaService;
    const service = new GiftsService(prisma, config, {} as GiftStellarService);

    await expect(
      service.createGift({
        idempotencyKey: 'gift-key',
        userId: 'user-1',
        walletAccountId: 'wallet-1',
        amount: '500',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.gift.create).not.toHaveBeenCalled();
  });

  it('blocks gift creation when sender email is not in the allowlist', async () => {
    const gatedConfig = {
      get: (key: string) =>
        ({
          GIFT_ALLOWED_EMAILS: 'founder@pigfi.app',
          GIFT_MIN_USD: 1,
          GIFT_MAX_USD: 100,
        })[key],
    } as unknown as ConfigService;
    const prisma = {
      gift: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ email: 'someone@else.com' }),
      },
    } as unknown as PrismaService;
    const service = new GiftsService(
      prisma,
      gatedConfig,
      {} as GiftStellarService,
    );

    await expect(
      service.createGift({
        idempotencyKey: 'gift-key-2',
        userId: 'user-1',
        walletAccountId: 'wallet-1',
        amount: '10',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.gift.create).not.toHaveBeenCalled();
  });

  it('forbids claiming with an account created before the gift', async () => {
    const future = new Date();
    future.setDate(future.getDate() + 5);
    const prisma = {
      gift: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'gift-1',
          status: GiftStatus.FUNDED,
          senderUserId: 'sender-1',
          balanceId: 'balance-1',
          amount: new Decimal('50'),
          createdAt: new Date('2026-07-02T00:00:00Z'),
          expiresAt: future,
        }),
        updateMany: jest.fn(),
      },
      user: {
        // Account is OLDER than the gift → not eligible
        findUnique: jest.fn().mockResolvedValue({
          createdAt: new Date('2026-07-01T00:00:00Z'),
        }),
      },
    } as unknown as PrismaService;
    const service = new GiftsService(prisma, config, {} as GiftStellarService);

    await expect(
      service.claimGift('code-1', {
        userId: 'user-1',
        walletAccountId: 'wallet-1',
        stellarAddress: 'G'.padEnd(56, 'A'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.gift.updateMany).not.toHaveBeenCalled();
  });
});
