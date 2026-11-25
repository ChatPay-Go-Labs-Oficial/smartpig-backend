import { Test, TestingModule } from '@nestjs/testing';
import { RampService } from './ramp.service';
import { BlindPayService } from '../blindpay/blindpay.service';
import { StellarService } from '../wallets/stellar.service';
import { PrismaService } from '../infra/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, RampStatus } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

const mockNotifications = { notify: jest.fn().mockResolvedValue(undefined) };

const mockBlindPayService = {
  createReceiver: jest.fn(),
  createBankAccount: jest.fn(),
  createBlockchainWallet: jest.fn(),
  createAssetTrustline: jest.fn(),
  mintUsdbStellar: jest.fn(),
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
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  },
  blindPayBlockchainWallet: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  onrampTransaction: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  offrampTransaction: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

// As escritas transacionais do serviço recebem o próprio client mockado como `tx`.
// Definido fora do literal porque `typeof mockPrisma` não pode se referenciar
// dentro da própria inicialização. `clearAllMocks` limpa chamadas, não
// implementações, então isso continua valendo entre os testes.
mockPrisma.$transaction.mockImplementation(
  (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma),
);

const mockConfig = {
  get: jest.fn().mockReturnValue('testnet'),
  getOrThrow: jest.fn(),
};

const mockStellarService = {
  buildSponsoredFeeBumpXdr: jest.fn(),
};

describe('RampService', () => {
  let service: RampService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RampService,
        { provide: BlindPayService, useValue: mockBlindPayService },
        { provide: StellarService, useValue: mockStellarService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<RampService>(RampService);
  });

  // ─── Receiver ────────────────────────────────────────────────────────────────

  describe('createReceiver', () => {
    it('throws if receiver already exists', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({ id: 'r1' });
      await expect(
        service.createReceiver({ userId: 'u1', email: 'alice@example.com' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates receiver when none exists', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(null);
      mockBlindPayService.createReceiver.mockResolvedValue({ id: 'bp_r1' });
      mockPrisma.blindPayReceiver.create.mockResolvedValue({
        id: 'r1',
        blindpayReceiverId: 'bp_r1',
      });
      mockPrisma.user.findUnique.mockResolvedValue({ name: null, email: null });
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await service.createReceiver({
        userId: 'u1',
        email: 'alice@example.com',
        firstName: 'Alice',
      });
      expect(result.blindpayReceiverId).toBe('bp_r1');
      expect(mockBlindPayService.createReceiver).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'individual',
          kyc_type: 'standard',
          email: 'alice@example.com',
          country: 'BR',
        }),
      );
    });

    it('fills users.name and users.email from the KYC data', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(null);
      mockBlindPayService.createReceiver.mockResolvedValue({ id: 'bp_r1' });
      mockPrisma.blindPayReceiver.create.mockResolvedValue({
        id: 'r1',
        blindpayReceiverId: 'bp_r1',
      });
      mockPrisma.user.findUnique.mockResolvedValue({ name: null, email: null });
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await service.createReceiver({
        userId: 'u1',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Silva',
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { name: 'Alice Silva', email: 'alice@example.com' },
      });
    });

    it('does not overwrite a name or email the user already has', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(null);
      mockBlindPayService.createReceiver.mockResolvedValue({ id: 'bp_r1' });
      mockPrisma.blindPayReceiver.create.mockResolvedValue({
        id: 'r1',
        blindpayReceiverId: 'bp_r1',
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        name: 'Lili',
        email: 'lili@example.com',
      });

      await service.createReceiver({
        userId: 'u1',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Silva',
      });

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('skips the email when another account already uses it, keeping the name', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(null);
      mockBlindPayService.createReceiver.mockResolvedValue({ id: 'bp_r1' });
      mockPrisma.blindPayReceiver.create.mockResolvedValue({
        id: 'r1',
        blindpayReceiverId: 'bp_r1',
      });
      mockPrisma.user.findUnique.mockResolvedValue({ name: null, email: null });
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u2' });

      await service.createReceiver({
        userId: 'u1',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Silva',
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { name: 'Alice Silva' },
      });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(null);
      mockBlindPayService.createReceiver.mockResolvedValue({ id: 'bp_r1' });
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.createReceiver({ userId: 'u1', email: 'alice@example.com' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.blindPayReceiver.create).not.toHaveBeenCalled();
    });
  });

  describe('createBlockchainWallet', () => {
    it('registers the wallet without marking the user onboarded — that now waits for KYC approval', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({
        id: 'r1',
        blindpayReceiverId: 'bp_r1',
        name: 'Alice Silva',
      });
      mockBlindPayService.createBlockchainWallet.mockResolvedValue({
        id: 'bp_w1',
      });
      mockPrisma.blindPayBlockchainWallet.create.mockResolvedValue({
        id: 'w1',
      });
      mockBlindPayService.createAssetTrustline.mockResolvedValue('AAAA...');

      const result = await service.createBlockchainWallet({
        userId: 'u1',
        stellarAddress: 'GABC',
      });

      expect(result.trustlineXdr).toBe('AAAA...');
      // A wallet ser registrada não significa que a BlindPay aprovou o KYC —
      // `isOnboarded` é ligado em RampKycService, quando o status vira APPROVED.
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('getReceiver', () => {
    it('throws NotFoundException if not found', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(null);
      await expect(service.getReceiver('u1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── On-ramp ─────────────────────────────────────────────────────────────────

  describe('createOnramp', () => {
    it('throws if receiver not found', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(null);
      await expect(
        service.createOnramp({
          userId: 'u1',
          blockchainWalletId: 'w1',
          amountBrl: 1000,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws if wallet not found', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({ id: 'r1' });
      mockPrisma.blindPayBlockchainWallet.findFirst.mockResolvedValue(null);
      await expect(
        service.createOnramp({
          userId: 'u1',
          blockchainWalletId: 'w1',
          amountBrl: 1000,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates on-ramp transaction with PIX code', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({ id: 'r1' });
      mockPrisma.blindPayBlockchainWallet.findFirst.mockResolvedValue({
        id: 'w1',
        blindpayWalletId: 'bw_1',
        address: 'GABC123',
      });
      mockBlindPayService.createPayinQuote.mockResolvedValue({
        id: 'pq_1',
        receiver_amount: 5000000,
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
      expect(mockBlindPayService.createPayinStellar).toHaveBeenCalledWith({
        payin_quote_id: 'pq_1',
      });
    });
  });

  describe('listTransactions', () => {
    it('returns sanitized on/off-ramp records in newest-first order', async () => {
      mockPrisma.onrampTransaction.findMany.mockResolvedValue([
        {
          id: 'or1',
          amountBrl: new Prisma.Decimal(10000),
          amountUsdc: new Prisma.Decimal(1950),
          status: RampStatus.COMPLETED,
          completedAt: new Date('2026-10-15T12:01:00.000Z'),
          createdAt: new Date('2026-10-15T12:00:00.000Z'),
        },
      ]);
      mockPrisma.offrampTransaction.findMany.mockResolvedValue([
        {
          id: 'of1',
          amountBrl: new Prisma.Decimal(5000),
          amountUsdc: new Prisma.Decimal(10000000),
          status: RampStatus.PROCESSING,
          completedAt: null,
          createdAt: new Date('2026-10-15T13:00:00.000Z'),
        },
      ]);

      const result = await service.listTransactions('u1');

      expect(result.map(({ id, direction }) => ({ id, direction }))).toEqual([
        { id: 'of1', direction: 'OFFRAMP' },
        { id: 'or1', direction: 'ONRAMP' },
      ]);
      expect(result).toEqual([
        expect.objectContaining({
          amountBrl: '50.00',
          amountUsdc: '10.000000',
        }),
        expect.objectContaining({ amountBrl: '100.00', amountUsdc: '19.50' }),
      ]);
      expect(mockPrisma.onrampTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
        }),
      );
      expect(mockPrisma.offrampTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
        }),
      );
      expect(
        result.every(
          (transaction) =>
            !('pixCode' in transaction) &&
            !('unsignedDelegationXdr' in transaction),
        ),
      ).toBe(true);
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
      mockPrisma.blindPayBankAccount.findFirst.mockResolvedValue({
        id: 'ba1',
        blindpayBankAccountId: 'bp_ba1',
      });
      mockBlindPayService.createPayoutQuote.mockResolvedValue({
        id: 'qu_1',
        receiver_amount: 50000,
      });
      mockBlindPayService.prepareStellarDelegation.mockResolvedValue({
        transaction_hash: 'AAAA...delegation_xdr',
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
        service.submitOfframp('of1', 'u1', {
          userId: 'u1',
          signedDelegationHash: 'abc123',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws if status is not DELEGATION_NEEDED', async () => {
      mockPrisma.offrampTransaction.findFirst.mockResolvedValue({
        id: 'of1',
        status: RampStatus.COMPLETED,
      });
      await expect(
        service.submitOfframp('of1', 'u1', {
          userId: 'u1',
          signedDelegationHash: 'abc123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws if unsigned delegation XDR is missing', async () => {
      mockPrisma.offrampTransaction.findFirst.mockResolvedValue({
        id: 'of1',
        status: RampStatus.DELEGATION_NEEDED,
        blindpayQuoteId: 'qu_1',
        senderWalletAddress: 'GABC',
        userId: 'u1',
        unsignedDelegationXdr: null,
      });

      await expect(
        service.submitOfframp('of1', 'u1', {
          userId: 'u1',
          signedDelegationHash: 'abc123',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(
        mockStellarService.buildSponsoredFeeBumpXdr,
      ).not.toHaveBeenCalled();
    });

    it('wraps the signed delegation in a Treasury fee-bump before submitting to BlindPay', async () => {
      mockPrisma.offrampTransaction.findFirst.mockResolvedValue({
        id: 'of1',
        status: RampStatus.DELEGATION_NEEDED,
        blindpayQuoteId: 'qu_1',
        senderWalletAddress: 'GABC',
        userId: 'u1',
        unsignedDelegationXdr: 'AAAA...unsigned',
      });
      mockStellarService.buildSponsoredFeeBumpXdr.mockReturnValue(
        'AAAA...feebump',
      );
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
        userId: 'u1',
        signedDelegationHash: 'abc123',
      });

      expect(result.status).toBe(RampStatus.PROCESSING);
      expect(mockStellarService.buildSponsoredFeeBumpXdr).toHaveBeenCalledWith(
        'abc123',
        'AAAA...unsigned',
      );
      expect(mockBlindPayService.createPayoutStellar).toHaveBeenCalledWith({
        quote_id: 'qu_1',
        sender_wallet_address: 'GABC',
        signed_transaction: 'AAAA...feebump',
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

    it('notifica ONRAMP_COMPLETED depois de persistir a transição', async () => {
      mockPrisma.onrampTransaction.findUnique.mockResolvedValue({
        id: 'or1',
        userId: 'u1',
        status: RampStatus.AWAITING_PAYMENT,
        // Centavos, como o receiver_amount da cotação: 50 USDC.
        amountUsdc: new Prisma.Decimal('5000'),
      });
      const order: string[] = [];
      mockPrisma.onrampTransaction.update.mockImplementation(() => {
        order.push('update');
        return Promise.resolve({});
      });
      mockNotifications.notify.mockImplementation(() => {
        order.push('notify');
        return Promise.resolve();
      });

      await service.handlePayinWebhook('pi_1', 'completed');

      expect(order).toEqual(['update', 'notify']);
      expect(mockNotifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          type: 'ONRAMP_COMPLETED',
          dedupeKey: 'onramp:or1:COMPLETED',
          details: { amount: new Prisma.Decimal('50'), asset: 'USDC' },
        }),
      );
    });

    it('não notifica quando o status já era o final', async () => {
      mockPrisma.onrampTransaction.findUnique.mockResolvedValue({
        id: 'or1',
        userId: 'u1',
        status: RampStatus.COMPLETED,
      });
      mockPrisma.onrampTransaction.update.mockResolvedValue({});

      await service.handlePayinWebhook('pi_1', 'completed');

      expect(mockNotifications.notify).not.toHaveBeenCalled();
    });

    it('não notifica status intermediário', async () => {
      mockPrisma.onrampTransaction.findUnique.mockResolvedValue({
        id: 'or1',
        userId: 'u1',
        status: RampStatus.AWAITING_PAYMENT,
      });
      mockPrisma.onrampTransaction.update.mockResolvedValue({});

      await service.handlePayinWebhook('pi_1', 'processing');

      expect(mockNotifications.notify).not.toHaveBeenCalled();
    });

    it('refunded vira ONRAMP_FAILED', async () => {
      mockPrisma.onrampTransaction.findUnique.mockResolvedValue({
        id: 'or1',
        userId: 'u1',
        status: RampStatus.PROCESSING,
      });
      mockPrisma.onrampTransaction.update.mockResolvedValue({});

      await service.handlePayinWebhook('pi_1', 'refunded');

      expect(mockNotifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ONRAMP_FAILED',
          dedupeKey: 'onramp:or1:FAILED',
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

    it('notifica OFFRAMP_COMPLETED na transição', async () => {
      mockPrisma.offrampTransaction.findUnique.mockResolvedValue({
        id: 'of1',
        userId: 'u1',
        status: RampStatus.PROCESSING,
        // Micro-USDC, como o DTO do saque: 10 USDC.
        amountUsdc: new Prisma.Decimal('10000000'),
      });
      mockPrisma.offrampTransaction.update.mockResolvedValue({});

      await service.handlePayoutWebhook('po_1', 'completed');

      expect(mockNotifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          type: 'OFFRAMP_COMPLETED',
          dedupeKey: 'offramp:of1:COMPLETED',
          details: { amount: new Prisma.Decimal('10'), asset: 'USDC' },
        }),
      );
    });
  });

  describe('sync manual', () => {
    it('syncOfframpFromBlindPay notifica a transição para FAILED', async () => {
      mockPrisma.offrampTransaction.findFirst.mockResolvedValue({
        id: 'of1',
        userId: 'u1',
        status: RampStatus.PROCESSING,
        blindpayPayoutId: 'po_1',
      });
      mockBlindPayService.getPayout.mockResolvedValue({ status: 'failed' });
      mockPrisma.offrampTransaction.update.mockResolvedValue({});
      mockPrisma.offrampTransaction.findUnique.mockResolvedValue({ id: 'of1' });

      await service.syncOfframpFromBlindPay('of1', 'u1');

      expect(mockNotifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'OFFRAMP_FAILED',
          dedupeKey: 'offramp:of1:FAILED',
        }),
      );
    });

    it('syncOnrampFromBlindPay notifica a transição para COMPLETED', async () => {
      mockPrisma.onrampTransaction.findFirst.mockResolvedValue({
        id: 'or1',
        userId: 'u1',
        status: RampStatus.AWAITING_PAYMENT,
        blindpayPayinId: 'pi_1',
      });
      mockBlindPayService.getPayin.mockResolvedValue({ status: 'completed' });
      mockPrisma.onrampTransaction.update.mockResolvedValue({});
      mockPrisma.onrampTransaction.findUnique.mockResolvedValue({ id: 'or1' });

      await service.syncOnrampFromBlindPay('or1', 'u1');

      expect(mockNotifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ONRAMP_COMPLETED',
          dedupeKey: 'onramp:or1:COMPLETED',
        }),
      );
    });
  });

  // ─── Multi-rail (MX / AR / CO) ───────────────────────────────────────────────

  describe('createReceiver multi-rail', () => {
    const ENHANCED = {
      sourceOfFundsDocType: 'salary',
      sourceOfFundsDocFile: 'https://files.example.com/doc.pdf',
      purposeOfTransactions: 'savings',
    };

    beforeEach(() => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(null);
      mockBlindPayService.createReceiver.mockResolvedValue({ id: 'bp_r1' });
      mockPrisma.blindPayReceiver.create.mockResolvedValue({ id: 'r1' });
      mockPrisma.user.findUnique.mockResolvedValue({
        name: 'X',
        email: 'x@x.co',
      });
    });

    it('persiste BR quando o app não manda country', async () => {
      await service.createReceiver({ userId: 'u1', email: 'a@example.com' });
      expect(mockPrisma.blindPayReceiver.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ country: 'BR' }),
      });
    });

    it("converte 'light' em 'standard'", async () => {
      await service.createReceiver({
        userId: 'u1',
        email: 'a@example.com',
        kycType: 'light',
      });
      expect(mockBlindPayService.createReceiver).toHaveBeenCalledWith(
        expect.objectContaining({ kyc_type: 'standard' }),
      );
    });

    it.each(['MX', 'AR'])(
      'cria receiver %s com KYC standard',
      async (country) => {
        await service.createReceiver({
          userId: 'u1',
          email: 'a@example.com',
          country,
        });
        expect(mockBlindPayService.createReceiver).toHaveBeenCalledWith(
          expect.objectContaining({ country, kyc_type: 'standard' }),
        );
        expect(mockPrisma.blindPayReceiver.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ country }),
        });
      },
    );

    it('CO pessoa física vai como enhanced, com os campos enhanced', async () => {
      await service.createReceiver({
        userId: 'u1',
        email: 'a@example.com',
        country: 'CO',
        kycType: 'standard',
        idDocType: 'PASSPORT',
        ...ENHANCED,
      });
      expect(mockBlindPayService.createReceiver).toHaveBeenCalledWith(
        expect.objectContaining({
          country: 'CO',
          kyc_type: 'enhanced',
          source_of_funds_doc_type: 'salary',
          source_of_funds_doc_file: 'https://files.example.com/doc.pdf',
          purpose_of_transactions: 'savings',
        }),
      );
    });

    it.each([
      [{ country: 'CO' }, 'KYC_ENHANCED_FIELDS_REQUIRED'],
      [
        { country: 'CO', idDocType: 'DRIVERS' as const, ...ENHANCED },
        'KYC_ID_DOC_TYPE_NOT_ALLOWED',
      ],
      [{ country: 'CL' }, 'RAMP_COUNTRY_UNSUPPORTED'],
    ])('%#: recusa antes de chamar a BlindPay (%s)', async (extra, code) => {
      await expect(
        service.createReceiver({
          userId: 'u1',
          email: 'a@example.com',
          ...extra,
        }),
      ).rejects.toMatchObject({ response: { statusCode: 400, code } });
      expect(mockBlindPayService.createReceiver).not.toHaveBeenCalled();
      expect(mockPrisma.blindPayReceiver.create).not.toHaveBeenCalled();
    });
  });

  describe('createBankAccount multi-rail', () => {
    it('BR mantém o payload Pix atual', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({
        id: 'r1',
        blindpayReceiverId: 'bp_r1',
      });
      mockBlindPayService.createBankAccount.mockResolvedValue({ id: 'bp_ba1' });
      mockPrisma.blindPayBankAccount.create.mockResolvedValue({ id: 'ba1' });

      await service.createBankAccount({
        userId: 'u1',
        name: 'Conta',
        pixKey: 'a@pix',
      });

      expect(mockBlindPayService.createBankAccount).toHaveBeenCalledWith(
        'bp_r1',
        { type: 'pix', name: 'Conta', pix_key: 'a@pix' },
      );
      expect(mockPrisma.blindPayBankAccount.create).toHaveBeenCalledWith({
        data: {
          receiverId: 'r1',
          blindpayBankAccountId: 'bp_ba1',
          type: 'pix',
          pixKey: 'a@pix',
          isDefault: false,
        },
      });
    });

    it.each([
      [
        'MX',
        { spei: { beneficiaryName: 'Juan', speiClabe: '012345678901234567' } },
        'spei_bitso',
        {
          beneficiary_name: 'Juan',
          spei_protocol: 'clabe',
          spei_clabe: '012345678901234567',
        },
      ],
      [
        'AR',
        {
          transfers: {
            transfersType: 'ALIAS' as const,
            transfersAccount: 'mi.alias',
            beneficiaryName: 'Lucía',
          },
        },
        'transfers_bitso',
        {
          beneficiary_name: 'Lucía',
          transfers_type: 'ALIAS',
          transfers_account: 'mi.alias',
        },
      ],
      [
        'CO',
        {
          achCop: {
            beneficiaryFirstName: 'Andrés',
            beneficiaryLastName: 'Rojas',
            documentType: 'CC' as const,
            documentId: '1234567',
            email: 'andres@example.com',
            bankCode: '007',
            bankAccount: '123456',
            accountType: 'checking' as const,
          },
        },
        'ach_cop_bitso',
        {
          ach_cop_beneficiary_first_name: 'Andrés',
          ach_cop_beneficiary_last_name: 'Rojas',
          ach_cop_document_id: '1234567',
          ach_cop_document_type: 'CC',
          ach_cop_email: 'andres@example.com',
          ach_cop_bank_code: '007',
          ach_cop_bank_account: '123456',
          account_type: 'checking',
        },
      ],
    ])(
      '%s cria conta %s e guarda details',
      async (country, input, type, details) => {
        mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({
          id: 'r1',
          blindpayReceiverId: 'bp_r1',
          country,
        });
        mockBlindPayService.createBankAccount.mockResolvedValue({
          id: 'bp_ba1',
        });
        mockPrisma.blindPayBankAccount.create.mockResolvedValue({ id: 'ba1' });

        await service.createBankAccount({
          userId: 'u1',
          name: 'Conta',
          ...input,
        });

        expect(mockBlindPayService.createBankAccount).toHaveBeenCalledWith(
          'bp_r1',
          { type, name: 'Conta', ...details },
        );
        expect(mockPrisma.blindPayBankAccount.create).toHaveBeenCalledWith({
          data: {
            receiverId: 'r1',
            blindpayBankAccountId: 'bp_ba1',
            type,
            pixKey: null,
            details,
            isDefault: false,
          },
        });
      },
    );

    it('recusa chave Pix num receiver MX sem chamar a BlindPay', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({
        id: 'r1',
        blindpayReceiverId: 'bp_r1',
        country: 'MX',
      });

      await expect(
        service.createBankAccount({
          userId: 'u1',
          name: 'Conta',
          pixKey: 'a@pix',
        }),
      ).rejects.toMatchObject({
        response: { code: 'BANK_ACCOUNT_DETAILS_MISMATCH' },
      });
      expect(mockBlindPayService.createBankAccount).not.toHaveBeenCalled();
    });

    it('exige os detalhes do rail', async () => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({
        id: 'r1',
        blindpayReceiverId: 'bp_r1',
        country: 'CO',
      });

      await expect(
        service.createBankAccount({ userId: 'u1', name: 'Conta' }),
      ).rejects.toMatchObject({
        response: { code: 'BANK_ACCOUNT_DETAILS_REQUIRED' },
      });
    });
  });

  describe('onramp multi-rail', () => {
    const WALLET = { id: 'w1', blindpayWalletId: 'bw_1', address: 'GABC' };
    const PSE_PAYER = {
      fullName: 'Andrés Rojas',
      documentType: 'CC' as const,
      documentNumber: '1234567890',
      email: 'andres@example.com',
      phone: '+573001234567',
      bankCode: '1007',
    };

    function givenReceiver(country?: string) {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({
        id: 'r1',
        ...(country ? { country } : {}),
      });
      mockPrisma.blindPayBlockchainWallet.findFirst.mockResolvedValue(WALLET);
      mockBlindPayService.createPayinQuote.mockResolvedValue({
        id: 'pq_1',
        sender_amount: 50000,
        receiver_amount: 2500,
      });
      mockPrisma.onrampTransaction.create.mockResolvedValue({ id: 'or1' });
    }

    it('getOnrampQuote lê o país do receiver', async () => {
      givenReceiver('MX');
      await service.getOnrampQuote({
        userId: 'u1',
        blockchainWalletId: 'w1',
        amountFiat: 50000,
      });
      expect(mockPrisma.blindPayReceiver.findUnique).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        select: { id: true, country: true },
      });
      expect(mockBlindPayService.createPayinQuote).toHaveBeenCalledWith({
        blockchain_wallet_id: 'bw_1',
        token: expect.any(String),
        partner_fee_id: expect.anything(),
        payment_method: 'spei',
        currency_type: 'sender',
        request_amount: 50000,
      });
    });

    it('BR segue mandando pix, sem payer_rules', async () => {
      givenReceiver();
      await service.getOnrampQuote({
        userId: 'u1',
        blockchainWalletId: 'w1',
        amountBrl: 1050,
      });
      const params = mockBlindPayService.createPayinQuote.mock.calls[0][0];
      expect(params).toMatchObject({
        payment_method: 'pix',
        currency_type: 'sender',
        request_amount: 1050,
      });
      expect(params).not.toHaveProperty('payer_rules');
    });

    it('AR manda payer_rules transfers com CUIT normalizado', async () => {
      givenReceiver('AR');
      await service.getOnrampQuote({
        userId: 'u1',
        blockchainWalletId: 'w1',
        amountFiat: 100000,
        transfersPayer: { allowedTaxId: '20123456786' },
      });
      expect(mockBlindPayService.createPayinQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_method: 'transfers',
          payer_rules: { transfers_allowed_tax_id: '20-12345678-6' },
        }),
      );
    });

    it('CO repete payer_rules em toda tentativa do fluxo amountUsd', async () => {
      givenReceiver('CO');
      mockBlindPayService.createPayinQuote
        .mockResolvedValueOnce({ id: 'pq_1', receiver_amount: 900 })
        .mockResolvedValueOnce({ id: 'pq_2', receiver_amount: 1000 });

      await service.getOnrampQuote({
        userId: 'u1',
        blockchainWalletId: 'w1',
        amountUsd: 1000,
        psePayer: PSE_PAYER,
      });

      expect(mockBlindPayService.createPayinQuote).toHaveBeenCalledTimes(2);
      for (const [params] of mockBlindPayService.createPayinQuote.mock.calls) {
        expect(params).toMatchObject({
          payment_method: 'pse',
          currency_type: 'receiver',
          payer_rules: expect.objectContaining({ pse_phone: '+573001234567' }),
        });
      }
    });

    it.each([
      ['AR', { amountFiat: 100000 }, 'PAYER_RULES_REQUIRED'],
      ['BR', { amountBrl: 1000, psePayer: PSE_PAYER }, 'PAYER_RULES_MISMATCH'],
      ['MX', { amountFiat: 12345 }, 'AMOUNT_MUST_BE_WHOLE_UNIT'],
      ['MX', { amountBrl: 1000 }, 'AMOUNT_CURRENCY_MISMATCH'],
      [undefined, { amountBrl: 1000, amountFiat: 1000 }, 'AMOUNT_AMBIGUOUS'],
      [undefined, {}, 'AMOUNT_REQUIRED'],
    ])('%s %o → %s sem cotar', async (country, amounts, code) => {
      givenReceiver(country);
      await expect(
        service.createOnramp({
          userId: 'u1',
          blockchainWalletId: 'w1',
          ...amounts,
        }),
      ).rejects.toMatchObject({ response: { statusCode: 400, code } });
      expect(mockBlindPayService.createPayinQuote).not.toHaveBeenCalled();
    });

    it('BR grava BRL, pixCode e a instrução pix', async () => {
      givenReceiver();
      mockBlindPayService.createPayinStellar.mockResolvedValue({
        id: 'pi_1',
        pix_code: '000201',
      });

      await service.createOnramp({
        userId: 'u1',
        blockchainWalletId: 'w1',
        amountBrl: 1000,
      });

      expect(mockPrisma.onrampTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fiatCurrency: 'BRL',
          amountBrl: 50000,
          pixCode: '000201',
          paymentInstructions: { method: 'pix', pixCode: '000201' },
        }),
      });
    });

    it.each([
      [
        'MX',
        {},
        { clabe: '646180000000000000' },
        { method: 'spei', clabe: '646180000000000000' },
        'MXN',
      ],
      [
        'AR',
        { transfersPayer: { allowedTaxId: '20-12345678-6' } },
        {
          tracking_transaction: {
            transfers_instruction: { account: '0000003100', type: 'CVU' },
          },
        },
        { method: 'transfers', account: '0000003100', accountType: 'CVU' },
        'ARS',
      ],
      [
        'CO',
        { psePayer: PSE_PAYER },
        { pse_payment_link: 'https://pse.example/pay' },
        { method: 'pse', paymentLink: 'https://pse.example/pay' },
        'COP',
      ],
    ])(
      '%s grava moeda e instrução, sem pixCode nem payer_rules',
      async (country, payer, payin, instructions, currency) => {
        givenReceiver(country);
        mockBlindPayService.createPayinStellar.mockResolvedValue({
          id: 'pi_1',
          pix_code: null,
          ...payin,
        });

        await service.createOnramp({
          userId: 'u1',
          blockchainWalletId: 'w1',
          amountFiat: 50000,
          ...payer,
        });

        const { data } = mockPrisma.onrampTransaction.create.mock.calls[0][0];
        expect(data).toMatchObject({
          fiatCurrency: currency,
          amountBrl: 50000,
          pixCode: null,
          paymentInstructions: instructions,
        });
        expect(JSON.stringify(data)).not.toMatch(/payer|tax_id|pse_/);
      },
    );

    it('grava DbNull quando a instrução ainda não veio', async () => {
      givenReceiver('MX');
      mockBlindPayService.createPayinStellar.mockResolvedValue({
        id: 'pi_1',
        pix_code: null,
      });

      await service.createOnramp({
        userId: 'u1',
        blockchainWalletId: 'w1',
        amountFiat: 50000,
      });

      expect(mockPrisma.onrampTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ paymentInstructions: Prisma.DbNull }),
      });
    });

    it('sync preenche a instrução que faltava enquanto o payin está aberto', async () => {
      mockPrisma.onrampTransaction.findFirst.mockResolvedValue({
        id: 'or1',
        userId: 'u1',
        status: RampStatus.PROCESSING,
        blindpayPayinId: 'pi_1',
        fiatCurrency: 'MXN',
        paymentInstructions: null,
      });
      mockBlindPayService.getPayin.mockResolvedValue({
        status: 'processing',
        clabe: '646180000000000000',
      });
      mockPrisma.onrampTransaction.findUnique.mockResolvedValue({ id: 'or1' });

      await service.syncOnrampFromBlindPay('or1', 'u1');

      expect(mockPrisma.onrampTransaction.update).toHaveBeenCalledWith({
        where: { id: 'or1' },
        data: {
          paymentInstructions: { method: 'spei', clabe: '646180000000000000' },
        },
      });
    });

    it('sync não mexe na instrução de payin já finalizado', async () => {
      mockPrisma.onrampTransaction.findFirst.mockResolvedValue({
        id: 'or1',
        userId: 'u1',
        status: RampStatus.COMPLETED,
        blindpayPayinId: 'pi_1',
        fiatCurrency: 'MXN',
        paymentInstructions: null,
      });
      mockBlindPayService.getPayin.mockResolvedValue({
        status: 'completed',
        clabe: '646180000000000000',
      });
      mockPrisma.onrampTransaction.findUnique.mockResolvedValue({ id: 'or1' });

      await service.syncOnrampFromBlindPay('or1', 'u1');

      expect(mockPrisma.onrampTransaction.update).not.toHaveBeenCalled();
    });
  });

  describe('offramp e histórico multi-rail', () => {
    function givenOfframp(type?: string) {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({ id: 'r1' });
      mockPrisma.blindPayBankAccount.findFirst.mockResolvedValue({
        id: 'ba1',
        blindpayBankAccountId: 'bp_ba1',
        ...(type ? { type } : {}),
      });
      mockBlindPayService.createPayoutQuote.mockResolvedValue({
        id: 'qu_1',
        receiver_amount: 18000,
      });
      mockBlindPayService.prepareStellarDelegation.mockResolvedValue({
        transaction_hash: 'AAAA',
      });
      mockPrisma.offrampTransaction.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'of1', ...data }),
      );
    }

    it.each([
      [undefined, 'BRL'],
      ['pix', 'BRL'],
      ['spei_bitso', 'MXN'],
      ['transfers_bitso', 'ARS'],
      ['ach_cop_bitso', 'COP'],
    ])('conta %s → fiatCurrency %s', async (type, currency) => {
      givenOfframp(type);

      const result = await service.createOfframp({
        userId: 'u1',
        bankAccountId: 'ba1',
        senderWalletAddress: 'GABC',
        amountUsdc: 1000000,
      });

      expect(mockPrisma.offrampTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fiatCurrency: currency,
          amountBrl: 18000,
        }),
      });
      expect(result).toMatchObject({
        fiatCurrency: currency,
        amountFiat: 18000,
        amountBrl: 18000,
      });
    });

    it('refreshOfframpDelegation devolve a moeda salva', async () => {
      mockPrisma.offrampTransaction.findFirst.mockResolvedValue({
        id: 'of1',
        status: RampStatus.DELEGATION_NEEDED,
        bankAccountId: 'ba1',
        amountUsdc: new Prisma.Decimal(1000000),
        senderWalletAddress: 'GABC',
        fiatCurrency: 'COP',
      });
      mockPrisma.blindPayBankAccount.findUnique.mockResolvedValue({
        id: 'ba1',
        blindpayBankAccountId: 'bp_ba1',
      });
      mockBlindPayService.createPayoutQuote.mockResolvedValue({
        id: 'qu_2',
        receiver_amount: 400000,
      });
      mockBlindPayService.prepareStellarDelegation.mockResolvedValue({
        transaction_hash: 'BBBB',
      });

      const result = await service.refreshOfframpDelegation('of1', 'u1');

      expect(result).toMatchObject({
        fiatCurrency: 'COP',
        amountFiat: 400000,
        amountBrl: 400000,
      });
    });

    it('histórico misto: amountFiat sempre, amountBrl só em BRL', async () => {
      mockPrisma.onrampTransaction.findMany.mockResolvedValue([
        {
          id: 'or_mx',
          fiatCurrency: 'MXN',
          amountBrl: new Prisma.Decimal(50000),
          amountUsdc: new Prisma.Decimal(2500),
          status: RampStatus.COMPLETED,
          completedAt: null,
          createdAt: new Date('2026-11-20T12:00:00.000Z'),
        },
        {
          id: 'or_br',
          fiatCurrency: 'BRL',
          amountBrl: new Prisma.Decimal(10000),
          amountUsdc: new Prisma.Decimal(1950),
          status: RampStatus.COMPLETED,
          completedAt: null,
          createdAt: new Date('2026-11-19T12:00:00.000Z'),
        },
      ]);
      mockPrisma.offrampTransaction.findMany.mockResolvedValue([
        {
          id: 'of_co',
          fiatCurrency: 'COP',
          amountBrl: null,
          amountUsdc: new Prisma.Decimal(10000000),
          status: RampStatus.PROCESSING,
          completedAt: null,
          createdAt: new Date('2026-11-21T12:00:00.000Z'),
        },
      ]);

      const result = await service.listTransactions('u1');

      expect(result).toEqual([
        expect.objectContaining({
          id: 'of_co',
          fiatCurrency: 'COP',
          amountFiat: null,
          amountBrl: null,
        }),
        expect.objectContaining({
          id: 'or_mx',
          fiatCurrency: 'MXN',
          amountFiat: '500.00',
          amountBrl: null,
        }),
        expect.objectContaining({
          id: 'or_br',
          fiatCurrency: 'BRL',
          amountFiat: '100.00',
          amountBrl: '100.00',
        }),
      ]);
      for (const model of [
        mockPrisma.onrampTransaction,
        mockPrisma.offrampTransaction,
      ]) {
        expect(model.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            select: expect.objectContaining({ fiatCurrency: true }),
          }),
        );
      }
      expect(
        result.every(
          (transaction) =>
            !('pixCode' in transaction) &&
            !('paymentInstructions' in transaction),
        ),
      ).toBe(true);
    });
  });

  describe('fluxo BR legado (golden)', () => {
    it('envia à BlindPay exatamente os payloads de antes do multi-rail', async () => {
      // Receiver
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(null);
      mockBlindPayService.createReceiver.mockResolvedValue({ id: 'bp_r1' });
      mockPrisma.blindPayReceiver.create.mockResolvedValue({ id: 'r1' });
      mockPrisma.user.findUnique.mockResolvedValue({
        name: 'X',
        email: 'x@x.co',
      });

      await service.createReceiver({
        userId: 'u1',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Silva',
        taxId: '12345678900',
        tosId: 'to_1',
      });

      expect(mockBlindPayService.createReceiver).toHaveBeenCalledWith({
        type: 'individual',
        kyc_type: 'standard',
        email: 'alice@example.com',
        country: 'BR',
        first_name: 'Alice',
        last_name: 'Silva',
        tax_id: '12345678900',
        address_line_1: undefined,
        address_line_2: undefined,
        city: undefined,
        state_province_region: undefined,
        postal_code: undefined,
        date_of_birth: undefined,
        id_doc_country: undefined,
        id_doc_type: undefined,
        selfie_file: undefined,
        id_doc_front_file: undefined,
        id_doc_back_file: undefined,
        tos_id: 'to_1',
        source_of_funds_doc_type: undefined,
        source_of_funds_doc_file: undefined,
        purpose_of_transactions: undefined,
        purpose_of_transactions_explanation: undefined,
      });

      // Conta Pix — receiver legado, sem coluna country no mock.
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue({
        id: 'r1',
        blindpayReceiverId: 'bp_r1',
      });
      mockBlindPayService.createBankAccount.mockResolvedValue({ id: 'bp_ba1' });
      mockPrisma.blindPayBankAccount.create.mockResolvedValue({ id: 'ba1' });

      await service.createBankAccount({
        userId: 'u1',
        name: 'Conta',
        pixKey: 'alice@pix',
      });

      expect(mockBlindPayService.createBankAccount).toHaveBeenCalledWith(
        'bp_r1',
        { type: 'pix', name: 'Conta', pix_key: 'alice@pix' },
      );

      // Cotação de onramp em BRL
      mockPrisma.blindPayBlockchainWallet.findFirst.mockResolvedValue({
        id: 'w1',
        blindpayWalletId: 'bw_1',
        address: 'GABC',
      });
      mockBlindPayService.createPayinQuote.mockResolvedValue({ id: 'pq_1' });

      await service.getOnrampQuote({
        userId: 'u1',
        blockchainWalletId: 'w1',
        amountBrl: 1050,
      });

      const [params] = mockBlindPayService.createPayinQuote.mock.calls[0];
      expect(params).toEqual({
        blockchain_wallet_id: 'bw_1',
        token: 'testnet',
        partner_fee_id: 'testnet',
        payment_method: 'pix',
        currency_type: 'sender',
        request_amount: 1050,
      });
      expect(Object.keys(params)).not.toContain('payer_rules');
    });
  });

  describe('regras de KYC por receiver', () => {
    beforeEach(() => {
      mockPrisma.blindPayReceiver.findUnique.mockResolvedValue(null);
      mockBlindPayService.createReceiver.mockResolvedValue({ id: 'bp_r1' });
      mockPrisma.blindPayReceiver.create.mockResolvedValue({ id: 'r1' });
      mockPrisma.user.findUnique.mockResolvedValue({
        name: 'X',
        email: 'x@x.co',
      });
    });

    it('BR com kycType enhanced sem os campos → KYC_ENHANCED_FIELDS_REQUIRED', async () => {
      await expect(
        service.createReceiver({
          userId: 'u1',
          email: 'a@example.com',
          kycType: 'enhanced',
        }),
      ).rejects.toMatchObject({
        response: { code: 'KYC_ENHANCED_FIELDS_REQUIRED' },
      });
      expect(mockBlindPayService.createReceiver).not.toHaveBeenCalled();
    });

    it('CO pessoa jurídica sem kycType não é forçada a enhanced', async () => {
      await service.createReceiver({
        userId: 'u1',
        email: 'a@example.com',
        country: 'CO',
        type: 'business',
      });
      expect(mockBlindPayService.createReceiver).toHaveBeenCalledWith(
        expect.objectContaining({
          country: 'CO',
          type: 'business',
          kyc_type: 'standard',
        }),
      );
    });
  });

  describe('sync de instruções de pagamento', () => {
    it('não sobrescreve paymentInstructions já gravadas', async () => {
      mockPrisma.onrampTransaction.findFirst.mockResolvedValue({
        id: 'or1',
        userId: 'u1',
        status: RampStatus.PROCESSING,
        blindpayPayinId: 'pi_1',
        fiatCurrency: 'MXN',
        paymentInstructions: { method: 'spei', clabe: '646180000000000000' },
      });
      mockBlindPayService.getPayin.mockResolvedValue({
        status: 'processing',
        clabe: '646180000000000999',
      });
      mockPrisma.onrampTransaction.findUnique.mockResolvedValue({ id: 'or1' });

      await service.syncOnrampFromBlindPay('or1', 'u1');

      expect(mockPrisma.onrampTransaction.update).not.toHaveBeenCalled();
    });
  });
});
