import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EtherfuseRampService } from './etherfuse-ramp.service';
import { EtherfuseService } from '../etherfuse/etherfuse.service';
import { PrismaService } from '../infra/prisma/prisma.service';
import { EtherfuseKycStatus, EtherfuseOrderDirection, EtherfuseOrderStatus } from '@prisma/client';

const mockEtherfuse = {
  createChildOrg: jest.fn(),
  submitKyc: jest.fn(),
  uploadKycDocument: jest.fn(),
  getKycStatus: jest.fn(),
  acceptElectronicSignature: jest.fn(),
  acceptTermsAndConditions: jest.fn(),
  acceptCustomerAgreement: jest.fn(),
  createBankAccount: jest.fn(),
  getQuote: jest.fn(),
  createOrder: jest.fn(),
  getOrder: jest.fn(),
};

const mockPrisma = {
  etherfuseCustomer: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  etherfuseBankAccount: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  etherfuseOrder: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const baseCustomer = {
  id: 'cust-1',
  userId: 'user-1',
  etherfuseOrgId: 'ef-org-1',
  kycStatus: EtherfuseKycStatus.NOT_STARTED,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseBankAccount = {
  id: 'ba-1',
  customerId: 'cust-1',
  etherfuseBankId: 'ef-ba-1',
  clabe: '012345678901234567',
  accountType: 'personal',
  isCompliant: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('EtherfuseRampService', () => {
  let service: EtherfuseRampService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EtherfuseRampService,
        { provide: EtherfuseService, useValue: mockEtherfuse },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<EtherfuseRampService>(EtherfuseRampService);
  });

  // ─── createCustomer ─────────────────────────────────────────────────────────

  describe('createCustomer', () => {
    it('should create a new customer', async () => {
      mockPrisma.etherfuseCustomer.findUnique.mockResolvedValue(null);
      mockEtherfuse.createChildOrg.mockResolvedValue({ organizationId: 'ef-org-1' });
      mockPrisma.etherfuseCustomer.create.mockResolvedValue(baseCustomer);

      const result = await service.createCustomer({
        userId: 'user-1',
        email: 'test@example.com',
        firstName: 'Juan',
        lastName: 'Garcia',
      });

      expect(mockEtherfuse.createChildOrg).toHaveBeenCalledWith(
        expect.objectContaining({
          accountType: 'personal',
          userInfo: expect.objectContaining({ email: 'test@example.com' }),
        }),
      );
      expect(mockPrisma.etherfuseCustomer.create).toHaveBeenCalled();
      expect(result).toEqual(baseCustomer);
    });

    it('should throw if customer already exists', async () => {
      mockPrisma.etherfuseCustomer.findUnique.mockResolvedValue(baseCustomer);

      await expect(
        service.createCustomer({ userId: 'user-1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── submitKyc ──────────────────────────────────────────────────────────────

  describe('submitKyc', () => {
    it('should submit KYC and update status to PROPOSED', async () => {
      mockPrisma.etherfuseCustomer.findUnique.mockResolvedValue(baseCustomer);
      mockEtherfuse.submitKyc.mockResolvedValue(undefined);
      mockPrisma.etherfuseCustomer.update.mockResolvedValue({
        ...baseCustomer,
        kycStatus: EtherfuseKycStatus.PROPOSED,
      });

      const result = await service.submitKyc({
        userId: 'user-1',
        pubkey: 'GXXXXX',
        email: 'test@example.com',
        phoneNumber: '+521234567890',
        name: { givenName: 'Juan', familyName: 'Garcia' },
        address: {
          street: 'Av. Reforma 123',
          city: 'CDMX',
          region: 'CDMX',
          postalCode: '06600',
          country: 'MX',
        },
        occupation: 'Engineer',
      });

      expect(mockEtherfuse.submitKyc).toHaveBeenCalledWith(
        'ef-org-1',
        expect.objectContaining({ pubkey: 'GXXXXX', occupation: 'Engineer' }),
      );
      expect(result.kycStatus).toBe(EtherfuseKycStatus.PROPOSED);
    });

    it('should throw NotFoundException when customer does not exist', async () => {
      mockPrisma.etherfuseCustomer.findUnique.mockResolvedValue(null);

      await expect(
        service.submitKyc({
          userId: 'unknown',
          pubkey: 'G...',
          email: 'x@x.com',
          phoneNumber: '+521234567890',
          name: { givenName: 'A', familyName: 'B' },
          address: { street: 'X', city: 'Y', region: 'Z', postalCode: '00000', country: 'MX' },
          occupation: 'Dev',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getQuote ────────────────────────────────────────────────────────────────

  describe('getQuote', () => {
    it('should call etherfuse.getQuote with correct params', async () => {
      mockPrisma.etherfuseCustomer.findUnique.mockResolvedValue(baseCustomer);
      const mockQuote = { quoteId: 'q-1', destinationAmount: '1000', sourceAmount: '100' };
      mockEtherfuse.getQuote.mockResolvedValue(mockQuote);

      const result = await service.getQuote({
        userId: 'user-1',
        direction: 'onramp',
        sourceAsset: 'MXN',
        targetAsset: 'USDC:GA5ZSEJY...',
        sourceAmount: '100',
        walletAddress: 'GXXXXX',
      });

      expect(mockEtherfuse.getQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'ef-org-1',
          blockchain: 'stellar',
          quoteAssets: expect.objectContaining({ type: 'onramp', sourceAsset: 'MXN' }),
        }),
      );
      expect(result).toEqual(mockQuote);
    });
  });

  // ─── createOnramp ────────────────────────────────────────────────────────────

  describe('createOnramp', () => {
    it('should create onramp order', async () => {
      mockPrisma.etherfuseCustomer.findUnique.mockResolvedValue(baseCustomer);
      mockPrisma.etherfuseBankAccount.findUnique.mockResolvedValue(baseBankAccount);
      mockEtherfuse.createOrder.mockResolvedValue({
        onramp: { id: 'ef-ord-1', status: 'processing' },
      });
      mockPrisma.etherfuseOrder.create.mockResolvedValue({
        id: 'ord-1',
        status: EtherfuseOrderStatus.PROCESSING,
      });

      const result = await service.createOnramp({
        userId: 'user-1',
        bankAccountId: 'ba-1',
        quoteId: 'q-1',
        walletAddress: 'GXXXXX',
        sourceAsset: 'MXN',
        targetAsset: 'USDC:GA5ZSEJY...',
        sourceAmount: '100',
        destinationAmount: '5',
      });

      expect(mockEtherfuse.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          bankAccountId: 'ef-ba-1',
          quoteId: 'q-1',
          publicKey: 'GXXXXX',
        }),
      );
      expect(result.status).toBe(EtherfuseOrderStatus.PROCESSING);
    });

    it('should throw BadRequestException if bank account is not compliant', async () => {
      mockPrisma.etherfuseCustomer.findUnique.mockResolvedValue(baseCustomer);
      mockPrisma.etherfuseBankAccount.findUnique.mockResolvedValue({
        ...baseBankAccount,
        isCompliant: false,
      });

      await expect(
        service.createOnramp({
          userId: 'user-1',
          bankAccountId: 'ba-1',
          quoteId: 'q-1',
          walletAddress: 'GXXXXX',
          sourceAsset: 'MXN',
          targetAsset: 'USDC:...',
          sourceAmount: '100',
          destinationAmount: '5',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── createOfframp ───────────────────────────────────────────────────────────

  describe('createOfframp', () => {
    it('should create offramp and return unsigned XDR when present', async () => {
      mockPrisma.etherfuseCustomer.findUnique.mockResolvedValue(baseCustomer);
      mockPrisma.etherfuseBankAccount.findUnique.mockResolvedValue(baseBankAccount);
      mockEtherfuse.createOrder.mockResolvedValue({
        offramp: { id: 'ef-ord-2', status: 'pending_signature', burnTransaction: 'XDR_BASE64...' },
      });
      mockPrisma.etherfuseOrder.create.mockResolvedValue({
        id: 'ord-2',
        status: EtherfuseOrderStatus.PENDING_SIGNATURE,
        sourceAmount: '10',
        destinationAmount: '200',
        unsignedBurnXdr: 'XDR_BASE64...',
      });

      const result = await service.createOfframp({
        userId: 'user-1',
        bankAccountId: 'ba-1',
        quoteId: 'q-2',
        walletAddress: 'GXXXXX',
        sourceAsset: 'USDC:GA5ZSEJY...',
        targetAsset: 'MXN',
        sourceAmount: '10',
        destinationAmount: '200',
      });

      expect(result.unsignedBurnXdr).toBe('XDR_BASE64...');
      expect(result.status).toBe(EtherfuseOrderStatus.PENDING_SIGNATURE);
    });
  });

  // ─── submitOfframp ───────────────────────────────────────────────────────────

  describe('submitOfframp', () => {
    it('should update order to PROCESSING with signed XDR', async () => {
      mockPrisma.etherfuseCustomer.findUnique.mockResolvedValue(baseCustomer);
      mockPrisma.etherfuseOrder.findFirst.mockResolvedValue({
        id: 'ord-2',
        customerId: 'cust-1',
        status: EtherfuseOrderStatus.PENDING_SIGNATURE,
      });
      mockPrisma.etherfuseOrder.update.mockResolvedValue({
        id: 'ord-2',
        status: EtherfuseOrderStatus.PROCESSING,
        signedBurnXdr: 'SIGNED_XDR',
      });

      const result = await service.submitOfframp('ord-2', 'user-1', {
        signedBurnXdr: 'SIGNED_XDR',
      });

      expect(result.status).toBe(EtherfuseOrderStatus.PROCESSING);
    });

    it('should throw BadRequestException if order is not in PENDING_SIGNATURE', async () => {
      mockPrisma.etherfuseCustomer.findUnique.mockResolvedValue(baseCustomer);
      mockPrisma.etherfuseOrder.findFirst.mockResolvedValue({
        id: 'ord-2',
        customerId: 'cust-1',
        status: EtherfuseOrderStatus.PROCESSING,
      });

      await expect(
        service.submitOfframp('ord-2', 'user-1', { signedBurnXdr: 'XDR' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── Webhook handlers ────────────────────────────────────────────────────────

  describe('handleOrderUpdated', () => {
    it('should update order status on webhook', async () => {
      mockPrisma.etherfuseOrder.findUnique.mockResolvedValue({
        id: 'ord-1',
        etherfuseOrderId: 'ef-ord-1',
        status: EtherfuseOrderStatus.PROCESSING,
      });
      mockPrisma.etherfuseOrder.update.mockResolvedValue({});

      await service.handleOrderUpdated('ef-ord-1', 'completed');

      expect(mockPrisma.etherfuseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: EtherfuseOrderStatus.COMPLETED }),
        }),
      );
    });

    it('should not throw if order not found', async () => {
      mockPrisma.etherfuseOrder.findUnique.mockResolvedValue(null);
      await expect(service.handleOrderUpdated('unknown', 'completed')).resolves.toBeUndefined();
    });
  });

  describe('handleKycUpdated', () => {
    it('should update customer KYC status', async () => {
      mockPrisma.etherfuseCustomer.findUnique.mockResolvedValue(baseCustomer);
      mockPrisma.etherfuseCustomer.update.mockResolvedValue({});

      await service.handleKycUpdated('ef-org-1', true);

      expect(mockPrisma.etherfuseCustomer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { kycStatus: EtherfuseKycStatus.APPROVED },
        }),
      );
    });
  });

  describe('handleBankAccountUpdated', () => {
    it('should update bank account compliance', async () => {
      mockPrisma.etherfuseBankAccount.findUnique.mockResolvedValue(baseBankAccount);
      mockPrisma.etherfuseBankAccount.update.mockResolvedValue({});

      await service.handleBankAccountUpdated('ef-ba-1', true);

      expect(mockPrisma.etherfuseBankAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isCompliant: true },
        }),
      );
    });
  });
});
