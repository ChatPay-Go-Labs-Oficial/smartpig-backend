import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BlindPayKycStatus } from '@prisma/client';
import { RampKycService } from './kyc.service';
import { BlindPayService } from '../blindpay/blindpay.service';
import { PrismaService } from '../infra/prisma/prisma.service';

const mockBlindPay = {
  getReceiver: jest.fn(),
  getRfi: jest.fn(),
  submitRfi: jest.fn(),
  createReceiver: jest.fn(),
  createBankAccount: jest.fn(),
  createBlockchainWallet: jest.fn(),
};

const mockPrisma = {
  blindPayReceiver: { findUnique: jest.fn(), update: jest.fn() },
  blindPayBankAccount: { update: jest.fn() },
  blindPayBlockchainWallet: { update: jest.fn() },
  blindPayKycAttempt: { create: jest.fn() },
  user: { update: jest.fn() },
  // A transação só encadeia chamadas do mesmo mock — o callback recebe o
  // próprio objeto, então as asserções valem para dentro e fora dela.
  $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(mockPrisma)),
};

const REJECTED_RECEIVER = {
  id: 'loc_1',
  userId: 'user_1',
  blindpayReceiverId: 're_old',
  name: 'Maria Silva',
  taxId: '12345678900',
  tosId: 'to_abc',
  kycStatus: BlindPayKycStatus.REJECTED,
  rejectionReason: 'Corners cut off',
  kycWarnings: [{ message: 'Corners cut off' }],
  bankAccounts: [{ id: 'ba_1', pixKey: 'maria@pix.com' }],
  blockchainWallets: [{ id: 'bw_1', address: 'GABC' }],
};

const RESUBMIT_DTO = {
  userId: 'user_1',
  email: 'maria@example.com',
  firstName: 'Maria',
  lastName: 'Silva',
  taxId: '12345678900',
  // Aceite novo: o do cadastro recusado (`to_abc`) não pode ser reaproveitado.
  tosId: 'to_new',
};

describe('RampKycService', () => {
  let service: RampKycService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.blindPayReceiver.update.mockResolvedValue({
      kycUpdatedAt: new Date('2026-08-04T12:00:00Z'),
      updatedAt: new Date('2026-08-04T12:00:00Z'),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RampKycService,
        { provide: BlindPayService, useValue: mockBlindPay },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: () => 'testnet' } },
      ],
    }).compile();

    service = module.get<RampKycService>(RampKycService);
  });

  describe('getKycStatus', () => {
    it('marks the user as onboarded only once BlindPay approves', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({
        id: 'loc_1',
        blindpayReceiverId: 're_1',
      });
      mockBlindPay.getReceiver.mockResolvedValue({ kyc_status: 'approved' });

      const result = await service.getKycStatus('user_1');

      expect(result.kycStatus).toBe(BlindPayKycStatus.APPROVED);
      expect(result.canResubmit).toBe(false);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user_1' },
        data: { isOnboarded: true },
      });
    });

    it('does not touch isOnboarded while KYC is still verifying', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({
        id: 'loc_1',
        blindpayReceiverId: 're_1',
      });
      mockBlindPay.getReceiver.mockResolvedValue({ kyc_status: 'verifying' });

      await service.getKycStatus('user_1');

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('flattens kyc_warnings into a rejection reason and allows resubmission', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({
        id: 'loc_1',
        blindpayReceiverId: 're_1',
      });
      mockBlindPay.getReceiver.mockResolvedValue({
        kyc_status: 'rejected',
        kyc_warnings: [{ message: 'some edges or corners were cut off' }],
      });

      const result = await service.getKycStatus('user_1');

      expect(result.kycStatus).toBe(BlindPayKycStatus.REJECTED);
      expect(result.rejectionReason).toBe('some edges or corners were cut off');
      expect(result.canResubmit).toBe(true);
      expect(mockBlindPay.getRfi).not.toHaveBeenCalled();
    });

    it('fetches the open RFI when compliance has requested information', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({
        id: 'loc_1',
        blindpayReceiverId: 're_1',
      });
      mockBlindPay.getReceiver.mockResolvedValue({
        kyc_status: 'compliance_request',
      });
      mockBlindPay.getRfi.mockResolvedValue({ id: 'rfi_1', status: 'pending' });

      const result = await service.getKycStatus('user_1');

      expect(result.rfi).toEqual({ id: 'rfi_1', status: 'pending' });
    });

    it('falls back to VERIFYING on an unknown status instead of guessing', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({
        id: 'loc_1',
        blindpayReceiverId: 're_1',
      });
      mockBlindPay.getReceiver.mockResolvedValue({
        kyc_status: 'something_new',
      });

      const result = await service.getKycStatus('user_1');

      expect(result.kycStatus).toBe(BlindPayKycStatus.VERIFYING);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('throws when the user has no receiver', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(null);

      await expect(service.getKycStatus('user_1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('resubmitReceiver', () => {
    it('refuses to resubmit while the KYC has not been rejected', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({
        ...REJECTED_RECEIVER,
        kycStatus: BlindPayKycStatus.VERIFYING,
      });

      await expect(service.resubmitReceiver(RESUBMIT_DTO)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockBlindPay.createReceiver).not.toHaveBeenCalled();
    });

    it('creates a new customer and re-registers the Pix account and wallet against it', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(
        REJECTED_RECEIVER,
      );
      mockBlindPay.createReceiver.mockResolvedValue({ id: 're_new' });
      mockBlindPay.createBankAccount.mockResolvedValue({ id: 'bp_ba_new' });
      mockBlindPay.createBlockchainWallet.mockResolvedValue({
        id: 'bp_bw_new',
      });

      await service.resubmitReceiver(RESUBMIT_DTO);

      // A conta e a wallet ficam presas ao customer antigo, então precisam ser
      // recriadas contra o novo — reaproveitando os dados já salvos.
      expect(mockBlindPay.createBankAccount).toHaveBeenCalledWith('re_new', {
        type: 'pix',
        name: 'Maria Silva',
        pix_key: 'maria@pix.com',
      });
      expect(mockBlindPay.createBlockchainWallet).toHaveBeenCalledWith(
        're_new',
        expect.objectContaining({
          address: 'GABC',
          network: 'stellar_testnet',
        }),
      );
      expect(mockPrisma.blindPayBankAccount.update).toHaveBeenCalledWith({
        where: { id: 'ba_1' },
        data: { blindpayBankAccountId: 'bp_ba_new' },
      });
      expect(mockPrisma.blindPayBlockchainWallet.update).toHaveBeenCalledWith({
        where: { id: 'bw_1' },
        data: { blindpayWalletId: 'bp_bw_new' },
      });
    });

    it('archives the rejected customer and points the row at the new one', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(
        REJECTED_RECEIVER,
      );
      mockBlindPay.createReceiver.mockResolvedValue({ id: 're_new' });
      mockBlindPay.createBankAccount.mockResolvedValue({ id: 'bp_ba_new' });
      mockBlindPay.createBlockchainWallet.mockResolvedValue({
        id: 'bp_bw_new',
      });

      await service.resubmitReceiver(RESUBMIT_DTO);

      expect(mockPrisma.blindPayKycAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          receiverId: 'loc_1',
          blindpayReceiverId: 're_old',
          kycStatus: BlindPayKycStatus.REJECTED,
          rejectionReason: 'Corners cut off',
        }),
      });
      expect(mockPrisma.blindPayReceiver.update).toHaveBeenCalledWith({
        where: { id: 'loc_1' },
        data: expect.objectContaining({
          blindpayReceiverId: 're_new',
          kycStatus: BlindPayKycStatus.VERIFYING,
          rejectionReason: null,
        }),
      });
    });

    // Um `tos_id` "can only ever be linked to one customer", e o reenvio cria
    // um customer novo — o aceite do cadastro recusado já está queimado.
    it('refuses to resubmit without a fresh ToS acceptance', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(
        REJECTED_RECEIVER,
      );

      await expect(
        service.resubmitReceiver({ ...RESUBMIT_DTO, tosId: undefined }),
      ).rejects.toMatchObject({ response: { code: 'TOS_REQUIRED' } });
      expect(mockBlindPay.createReceiver).not.toHaveBeenCalled();
    });

    it('never falls back to the ToS bound to the rejected customer', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(
        REJECTED_RECEIVER,
      );
      mockBlindPay.createReceiver.mockResolvedValue({ id: 're_new' });
      mockBlindPay.createBankAccount.mockResolvedValue({ id: 'bp_ba_new' });
      mockBlindPay.createBlockchainWallet.mockResolvedValue({
        id: 'bp_bw_new',
      });

      await service.resubmitReceiver({ ...RESUBMIT_DTO, tosId: 'to_new' });

      expect(mockBlindPay.createReceiver).toHaveBeenCalledWith(
        expect.objectContaining({ tos_id: 'to_new' }),
      );
      expect(mockPrisma.blindPayReceiver.update).toHaveBeenCalledWith({
        where: { id: 'loc_1' },
        data: expect.objectContaining({ tosId: 'to_new' }),
      });
    });
  });

  describe('submitRfi', () => {
    beforeEach(() => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({
        id: 'loc_1',
        blindpayReceiverId: 're_1',
      });
    });

    const RFI = {
      id: 'rfi_1',
      status: 'pending',
      request: [
        {
          title: 'Business',
          description: 'desc',
          fields: [{ key: 'activity', label: 'Atividade', required: true }],
        },
      ],
    };

    it('sends the validated body and returns the customer to verifying', async () => {
      mockBlindPay.getRfi.mockResolvedValue(RFI);
      mockBlindPay.submitRfi.mockResolvedValue({ success: true });

      const result = await service.submitRfi('user_1', {
        activity: 'Fintech',
      });

      expect(result).toEqual({ success: true });
      expect(mockBlindPay.submitRfi).toHaveBeenCalledWith('re_1', {
        activity: 'Fintech',
      });
      expect(mockPrisma.blindPayReceiver.update).toHaveBeenCalledWith({
        where: { id: 'loc_1' },
        data: expect.objectContaining({
          kycStatus: BlindPayKycStatus.VERIFYING,
        }),
      });
    });

    it('rejects locally with per-field errors instead of burning the single submission', async () => {
      mockBlindPay.getRfi.mockResolvedValue(RFI);

      await expect(service.submitRfi('user_1', {})).rejects.toMatchObject({
        response: {
          code: 'RFI_INVALID',
          fields: { activity: expect.any(String) },
        },
      });
      expect(mockBlindPay.submitRfi).not.toHaveBeenCalled();
    });

    it('refuses to answer an RFI that is no longer pending', async () => {
      mockBlindPay.getRfi.mockResolvedValue({ ...RFI, status: 'submitted' });

      await expect(
        service.submitRfi('user_1', { activity: 'Fintech' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockBlindPay.submitRfi).not.toHaveBeenCalled();
    });

    it('throws when there is no open RFI', async () => {
      mockBlindPay.getRfi.mockResolvedValue(null);

      await expect(service.submitRfi('user_1', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('applyWebhookStatus', () => {
    it('persists the status for the receiver matching the BlindPay customer id', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({
        id: 'loc_1',
        userId: 'user_1',
      });

      await service.applyWebhookStatus('re_1', 'approved', null);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user_1' },
        data: { isOnboarded: true },
      });
    });

    it('ignores webhooks for customers it does not know', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(null);

      await expect(
        service.applyWebhookStatus('re_unknown', 'approved', null),
      ).resolves.toBeUndefined();
      expect(mockPrisma.blindPayReceiver.update).not.toHaveBeenCalled();
    });
  });
});
