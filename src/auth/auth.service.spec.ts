/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../infra/prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const mockVerify = jest.fn();
jest.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    fromPublicKey: () => ({ verify: mockVerify }),
  },
}));

const mockPrisma = {
  walletAccount: {
    findFirst: jest.fn(),
  },
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
  },
  refreshToken: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockRedis = {
  getAndDeleteNonce: jest.fn(),
  setNonce: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock-access-token'),
};

const mockConfig = {
  get: jest.fn().mockReturnValue(2592000),
};

const SIGNER_PK =
  'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE';
const SMART_ACCOUNT =
  'CBH6XACZFDCJUHX2G4ZDNXG5R52JRABJHWLYQOXFYKH6VFYRPAOZ5H7T';

function createWalletRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wallet-1',
    userId: 'user-1',
    stellarAddress: SIGNER_PK,
    smartAccountAddress: null,
    label: null,
    isActive: true,
    user: {
      id: 'user-1',
      name: null,
      email: null,
      avatarUrl: null,
      createdAt: new Date(),
    },
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ─── generateChallenge ───────────────────────────────────────────────

  describe('generateChallenge', () => {
    it('should generate a nonce and message for a regular wallet', async () => {
      const result = await service.generateChallenge(SIGNER_PK);

      expect(result.nonce).toHaveLength(64);
      expect(result.message).toContain('SmartPig login:');
      expect(result.message).toContain(result.nonce);
      expect(mockRedis.setNonce).toHaveBeenCalledWith(
        SIGNER_PK,
        result.nonce,
        300,
      );
    });

    it('should generate a nonce and message for a smart account', async () => {
      const result = await service.generateChallenge(SMART_ACCOUNT);

      expect(result.nonce).toHaveLength(64);
      expect(result.message).toContain('SmartPig login:');
      expect(mockRedis.setNonce).toHaveBeenCalledWith(
        SMART_ACCOUNT,
        result.nonce,
        300,
      );
    });
  });

  // ─── walletLogin ─────────────────────────────────────────────────────

  describe('walletLogin', () => {
    it('should throw if no nonce is found', async () => {
      mockRedis.getAndDeleteNonce.mockResolvedValue(null);

      await expect(
        service.walletLogin({
          signerPublicKey: SIGNER_PK,
          signature: 'base64sig',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw if signature verification fails', async () => {
      mockRedis.getAndDeleteNonce.mockResolvedValue(randomBytes(32).toString('hex'));
      mockVerify.mockReturnValue(false);

      await expect(
        service.walletLogin({
          signerPublicKey: SIGNER_PK,
          signature: 'invalid',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should consume the nonce even on failed verification (replay prevention)', async () => {
      mockRedis.getAndDeleteNonce.mockResolvedValue(randomBytes(32).toString('hex'));
      mockVerify.mockReturnValue(false);

      await expect(
        service.walletLogin({
          signerPublicKey: SIGNER_PK,
          signature: 'invalid',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockRedis.getAndDeleteNonce).toHaveBeenCalledWith(SIGNER_PK);
    });

    it('should login existing regular wallet', async () => {
      mockRedis.getAndDeleteNonce.mockResolvedValue(randomBytes(32).toString('hex'));
      mockVerify.mockReturnValue(true);

      mockPrisma.walletAccount.findFirst.mockResolvedValue(createWalletRow());
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.walletLogin({
        signerPublicKey: SIGNER_PK,
        signature: 'valid-base64',
      });

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeDefined();
      expect(result.isNewUser).toBe(false);
      expect(result.user.id).toBe('user-1');
      expect(result.wallet.smartAccountAddress).toBeNull();
    });

    it('should login existing smart account wallet', async () => {
      mockRedis.getAndDeleteNonce.mockResolvedValue(randomBytes(32).toString('hex'));
      mockVerify.mockReturnValue(true);

      mockPrisma.walletAccount.findFirst.mockResolvedValue(
        createWalletRow({ smartAccountAddress: SMART_ACCOUNT }),
      );
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.walletLogin({
        signerPublicKey: SIGNER_PK,
        signature: 'valid-base64',
        smartAccountAddress: SMART_ACCOUNT,
      });

      expect(result.isNewUser).toBe(false);
      expect(result.wallet.smartAccountAddress).toBe(SMART_ACCOUNT);
    });

    it('should create new user with smart account', async () => {
      mockRedis.getAndDeleteNonce.mockResolvedValue(randomBytes(32).toString('hex'));
      mockVerify.mockReturnValue(true);
      mockPrisma.walletAccount.findFirst.mockResolvedValue(null);

      const newUser = {
        id: 'user-new',
        name: null,
        email: null,
        avatarUrl: null,
        createdAt: new Date(),
      };

      mockPrisma.$transaction.mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type, @typescript-eslint/require-await
        async (cb: Function) => {
          return cb({
            user: {
              create: jest.fn().mockResolvedValue({ id: 'user-new' }),
              findUnique: jest.fn().mockResolvedValue(newUser),
            },
            walletAccount: {
              create: jest.fn().mockResolvedValue({
                id: 'wallet-new',
                stellarAddress: SIGNER_PK,
                smartAccountAddress: SMART_ACCOUNT,
                label: null,
                isActive: true,
              }),
            },
          });
        },
      );
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.walletLogin({
        signerPublicKey: SIGNER_PK,
        signature: 'valid-base64',
        smartAccountAddress: SMART_ACCOUNT,
      });

      expect(result.isNewUser).toBe(true);
      expect(result.wallet.smartAccountAddress).toBe(SMART_ACCOUNT);
      expect(result.wallet.stellarAddress).toBe(SIGNER_PK);
    });

    it('should reject reused nonce (replay attack)', async () => {
      mockRedis.getAndDeleteNonce.mockResolvedValue(randomBytes(32).toString('hex'));
      mockVerify.mockReturnValue(true);
      mockPrisma.walletAccount.findFirst.mockResolvedValue(createWalletRow());
      mockPrisma.refreshToken.create.mockResolvedValue({});

      await service.walletLogin({
        signerPublicKey: SIGNER_PK,
        signature: 'valid-base64',
      });

      mockRedis.getAndDeleteNonce.mockResolvedValue(null);

      await expect(
        service.walletLogin({
          signerPublicKey: SIGNER_PK,
          signature: 'valid-base64',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── refreshTokens ───────────────────────────────────────────────────

  describe('refreshTokens', () => {
    it('should rotate refresh token and issue new access token', async () => {
      const rawToken = randomBytes(48).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');

      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        tokenHash,
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 999999),
        user: {
          id: 'user-1',
          name: null,
          email: null,
          avatarUrl: null,
          createdAt: new Date(),
        },
      });
      mockPrisma.refreshToken.update.mockResolvedValue({});
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.refreshTokens(rawToken);

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeDefined();
      expect(result.refreshToken).not.toBe(rawToken);
      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rt-1' },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('should throw if token is revoked', async () => {
      const rawToken = randomBytes(48).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');

      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        tokenHash,
        userId: 'user-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 999999),
      });

      await expect(service.refreshTokens(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── logout ──────────────────────────────────────────────────────────

  describe('logout', () => {
    it('should return revoked:true idempotently', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
      const result = await service.logout('any-token');
      expect(result).toEqual({ revoked: true });
    });
  });

  // ─── walletLoginLegacy ───────────────────────────────────────────────

  describe('walletLoginLegacy', () => {
    it('should return existing user without tokens', async () => {
      mockPrisma.walletAccount.findFirst.mockResolvedValue(createWalletRow());

      const result = await service.walletLoginLegacy(SIGNER_PK);

      expect(result).not.toHaveProperty('accessToken');
      expect(result.isNewUser).toBe(false);
    });
  });
});
