import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy, JwtPayload } from './jwt.strategy';
import { PrismaService } from '../../infra/prisma/prisma.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let findUniqueSpy: jest.Mock;

  beforeEach(async () => {
    findUniqueSpy = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest
              .fn()
              .mockReturnValue('at-least-32-char-secret-key-for-test'),
          },
        },
        {
          provide: PrismaService,
          useValue: { user: { findUnique: findUniqueSpy } },
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  describe('validate', () => {
    const payload: JwtPayload = {
      sub: 'user-123',
      wallet: 'GABC12345678901234567890123456789012345678901234567890',
    };

    it('should return userId and wallet when user exists', async () => {
      findUniqueSpy.mockResolvedValue({ id: 'user-123' });

      const result = await strategy.validate(payload);

      expect(result).toEqual({ userId: 'user-123', wallet: payload.wallet });
      expect(findUniqueSpy).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        select: { id: true },
      });
    });

    it('should throw UnauthorizedException when user does not exist', async () => {
      findUniqueSpy.mockResolvedValue(null);

      await expect(strategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
