import { Test, TestingModule } from '@nestjs/testing';
import { RampService } from './ramp.service';
import { BlindPayService } from '../blindpay/blindpay.service';
import { PrismaService } from '../infra/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RampStatus } from '@prisma/client';

const mockBlindPayService = {
  createReceiver: jest.fn(),
  createBankAccount: jest.fn(),
  createBlockchainWallet: jest.fn(),
  createPayinQuote: jest.fn(),
  createPayinStellar: jest.fn(),
  createPayoutQuote: jest.fn(),
  prepareStellarDelegation: jest.fn(),
  createPayoutStellar: jest.fn(),
  getPayin: jest.fn(),
  getPayout: jest.fn(),
};

const mockPrisma = {
  blindPayReceiver: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  blindPayBankAccount: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  },
  blindPayBlockchainWallet: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  onrampTransaction: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  offrampTransaction: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockConfig = { get: jest.fn().mockReturnValue('testnet'), getOrThrow: jest.fn() };

describe('RampService', () => {
  let service: RampService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RampService,
        { provide: BlindPayService, useValue: mockBlindPayService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<RampService>(RampService);
  });

  // ─── Receiver ────────────────────────────────────────────────────────────────

  describe('createReceiver', () => {
    it('throws if receiver already exists', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({ id: 'r1' });
      await expect(
        service.createReceiver({ userId: 'u1', name: 'Alice' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates receiver when none exists', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(null);
      mockBlindPayService.createReceiver.mockResolvedValue({ id: 'bp_r1' });
      mockPrisma.blindPayReceiver.create.mockResolvedValue({ id: 'r1', blindpayReceiverId: 'bp_r1' });

      const result = await service.createReceiver({ userId: 'u1', email: 'alice@example.com', firstName: 'Alice' });
      expect(result.blindpayReceiverId).toBe('bp_r1');
      expect(mockBlindPayService.createReceiver).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'individual', kyc_type: 'standard', email: 'alice@example.com', country: 'BR' }),
      );
    });
  });

  describe('getReceiver', () => {
    it('throws NotFoundException if not found', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(null);
      await expect(service.getReceiver('u1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── On-ramp ─────────────────────────────────────────────────────────────────

  describe('createOnramp', () => {
    it('throws if receiver not found', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(null);
      await expect(
        service.createOnramp({ userId: 'u1', blockchainWalletId: 'w1', amountBrl: 1000 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws if wallet not found', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({ id: 'r1' });
      mockPrisma.blindPayBlockchainWallet.findUnique.mockResolvedValue(null);
      await expect(
        service.createOnramp({ userId: 'u1', blockchainWalletId: 'w1', amountBrl: 1000 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates on-ramp transaction with PIX code', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({ id: 'r1' });
      mockPrisma.blindPayBlockchainWallet.findUnique.mockResolvedValue({
        id: 'w1',
        blindpayWalletId: 'bw_1',
      });
      mockBlindPayService.createPayinQuote.mockResolvedValue({
        id: 'pq_1',
        payin_amount: 5000000,
      });
      mockBlindPayService.createPayinStellar.mockResolvedValue({
        id: 'pi_1',
        status: 'processing',
        pix_code: '00020101...',
      });
      mockPrisma.onrampTransaction.create.mockResolvedValue({
        id: 'or1',
        pixCode: '00020101...',
        status: RampStatus.AWAITING_PAYMENT,
      });

      const result = await service.createOnramp({
        userId: 'u1',
        blockchainWalletId: 'w1',
        amountBrl: 1000,
      });

      expect(result.pixCode).toBe('00020101...');
      expect(result.status).toBe(RampStatus.AWAITING_PAYMENT);
      expect(mockBlindPayService.createPayinStellar).toHaveBeenCalledWith({ payin_quote_id: 'pq_1' });
    });
  });

  // ─── Off-ramp ─────────────────────────────────────────────────────────────────

  describe('createOfframp', () => {
    it('throws if receiver not found', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(null);
      await expect(
        service.createOfframp({
          userId: 'u1',
          bankAccountId: 'ba1',
          senderWalletAddress: 'GABC',
          amountUsdc: 1000000,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns unsigned delegation XDR', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({ id: 'r1' });
      mockPrisma.blindPayBankAccount.findUnique.mockResolvedValue({
        id: 'ba1',
        blindpayBankAccountId: 'bp_ba1',
      });
      mockBlindPayService.createPayoutQuote.mockResolvedValue({
        id: 'qu_1',
        payout_amount: 50000,
      });
      mockBlindPayService.prepareStellarDelegation.mockResolvedValue({
        transaction: 'AAAA...delegation_xdr',
      });
      mockPrisma.offrampTransaction.create.mockResolvedValue({
        id: 'of1',
        status: RampStatus.DELEGATION_NEEDED,
        unsignedDelegationXdr: 'AAAA...delegation_xdr',
        amountUsdc: 1000000,
        amountBrl: 50000,
      });

      const result = await service.createOfframp({
        userId: 'u1',
        bankAccountId: 'ba1',
        senderWalletAddress: 'GABC',
        amountUsdc: 1000000,
      });

      expect(result.unsignedDelegationXdr).toBe('AAAA...delegation_xdr');
      expect(result.status).toBe(RampStatus.DELEGATION_NEEDED);
    });
  });

  describe('submitOfframp', () => {
    it('throws if transaction not found', async () => {
      mockPrisma.offrampTransaction.findFirst.mockResolvedValue(null);
      await expect(
        service.submitOfframp('of1', 'u1', { signedDelegationHash: 'abc123' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws if status is not DELEGATION_NEEDED', async () => {
      mockPrisma.offrampTransaction.findFirst.mockResolvedValue({
        id: 'of1',
        status: RampStatus.COMPLETED,
      });
      await expect(
        service.submitOfframp('of1', 'u1', { signedDelegationHash: 'abc123' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('submits payout and updates status to PROCESSING', async () => {
      mockPrisma.offrampTransaction.findFirst.mockResolvedValue({
        id: 'of1',
        status: RampStatus.DELEGATION_NEEDED,
        blindpayQuoteId: 'qu_1',
        senderWalletAddress: 'GABC',
        userId: 'u1',
      });
      mockBlindPayService.createPayoutStellar.mockResolvedValue({
        id: 'po_1',
        status: 'processing',
      });
      mockPrisma.offrampTransaction.update.mockResolvedValue({
        id: 'of1',
        status: RampStatus.PROCESSING,
        blindpayPayoutId: 'po_1',
      });

      const result = await service.submitOfframp('of1', 'u1', {
        signedDelegationHash: 'abc123',
      });

      expect(result.status).toBe(RampStatus.PROCESSING);
      expect(mockBlindPayService.createPayoutStellar).toHaveBeenCalledWith({
        quote_id: 'qu_1',
        sender_wallet_address: 'GABC',
        signed_transaction: 'abc123',
      });
    });
  });

  // ─── Webhook ──────────────────────────────────────────────────────────────────

  describe('handlePayinWebhook', () => {
    it('updates onramp transaction status to COMPLETED', async () => {
      mockPrisma.onrampTransaction.findUnique.mockResolvedValue({ id: 'or1' });
      mockPrisma.onrampTransaction.update.mockResolvedValue({});

      await service.handlePayinWebhook('pi_1', 'completed');

      expect(mockPrisma.onrampTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: RampStatus.COMPLETED }),
        }),
      );
    });

    it('does nothing if payin not found in DB', async () => {
      mockPrisma.onrampTransaction.findUnique.mockResolvedValue(null);
      await service.handlePayinWebhook('pi_unknown', 'completed');
      expect(mockPrisma.onrampTransaction.update).not.toHaveBeenCalled();
    });
  });

  describe('handlePayoutWebhook', () => {
    it('updates offramp transaction status to FAILED', async () => {
      mockPrisma.offrampTransaction.findUnique.mockResolvedValue({ id: 'of1' });
      mockPrisma.offrampTransaction.update.mockResolvedValue({});

      await service.handlePayoutWebhook('po_1', 'failed');

      expect(mockPrisma.offrampTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: RampStatus.FAILED }),
        }),
      );
    });
  });
});
