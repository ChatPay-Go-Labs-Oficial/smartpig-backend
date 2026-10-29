import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { GiftStatus } from '@prisma/client';
import { GiftsService } from './gifts.service';
import { GiftStellarService } from './gift-stellar.service';
import { PrismaService } from '../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const notifications = {
  notify: jest.fn().mockResolvedValue(undefined),
} as unknown as NotificationsService;

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
    const service = new GiftsService(
      prisma,
      config,
      {} as GiftStellarService,
      notifications,
    );

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
      notifications,
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
    const service = new GiftsService(
      prisma,
      config,
      {} as GiftStellarService,
      notifications,
    );

    await expect(
      service.claimGift('code-1', {
        userId: 'user-1',
        walletAccountId: 'wallet-1',
        stellarAddress: 'G'.padEnd(56, 'A'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.gift.updateMany).not.toHaveBeenCalled();
  });

  describe('push de presente resgatado', () => {
    function claimSetup(failOnChain = false) {
      const future = new Date();
      future.setDate(future.getDate() + 5);
      const order: string[] = [];
      const prisma = {
        gift: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'gift-1',
            status: GiftStatus.FUNDED,
            senderUserId: 'sender-1',
            balanceId: 'balance-1',
            amount: new Decimal('50'),
            assetSymbol: 'USDC',
            createdAt: new Date('2026-07-01T00:00:00Z'),
            expiresAt: future,
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn(() => {
            order.push('persist');
            return Promise.resolve({
              id: 'gift-1',
              status: GiftStatus.CLAIMED,
            });
          }),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({
            createdAt: new Date('2026-07-02T00:00:00Z'),
            username: 'maria',
          }),
        },
        walletAccount: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ stellarAddress: 'G'.padEnd(56, 'A') }),
        },
      } as unknown as PrismaService;
      const stellar = {
        claimAndPay: failOnChain
          ? jest.fn().mockRejectedValue(new Error('horizon down'))
          : jest.fn().mockResolvedValue({ hash: 'tx-hash' }),
      } as unknown as GiftStellarService;
      const notify = jest.fn(() => {
        order.push('notify');
        return Promise.resolve();
      });
      const service = new GiftsService(prisma, config, stellar, {
        notify,
      } as unknown as NotificationsService);
      return { service, notify, order };
    }

    const dto = {
      userId: 'user-1',
      walletAccountId: 'wallet-1',
      stellarAddress: 'G'.padEnd(56, 'A'),
    };

    it('avisa quem enviou, com o @username do destinatário, depois do CLAIMED', async () => {
      const { service, notify, order } = claimSetup();

      await service.claimGift('code-1', dto);

      expect(order).toEqual(['persist', 'notify']);
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'sender-1',
          type: 'GIFT_CLAIMED',
          dedupeKey: 'gift:gift-1:CLAIMED',
          details: {
            amount: new Decimal('50'),
            asset: 'USDC',
            username: 'maria',
          },
        }),
      );
    });

    it('não avisa quando o resgate falha na rede', async () => {
      const { service, notify } = claimSetup(true);

      await expect(service.claimGift('code-1', dto)).rejects.toThrow();
      expect(notify).not.toHaveBeenCalled();
    });
  });
});
