import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
// canonicalize implements RFC 8785 JCS (required by Etherfuse webhook verification)
import canonicalize from 'canonicalize';
import type { Request } from 'express';
import { EtherfuseRampService } from './etherfuse-ramp.service';
import {
  AcceptAgreementDto,
  CreateEtherfuseCustomerDto,
  CreateEtherfuseOfframpDto,
  CreateEtherfuseOnrampDto,
  CreatePersonalBankAccountDto,
  CreatePixBankAccountDto,
  GeneratePresignedUrlDto,
  GetEtherfuseQuoteDto,
  GetKycStatusDto,
  SubmitEtherfuseOfframpDto,
  SubmitKycDto,
  UploadKycDocumentDto,
  UserIdDto,
} from './dto/etherfuse-ramp.dto';

@ApiTags('Etherfuse Ramp')
@Controller()
export class EtherfuseRampController {
  constructor(
    private readonly service: EtherfuseRampService,
    private readonly config: ConfigService,
  ) {}

  // ─── Onboarding: Organization ───────────────────────────────────────────────

  @Post('etherfuse/onboarding/organization')
  @ApiOperation({
    summary: 'Create Etherfuse child organization for the user',
    description: 'Creates a personal child org under the SmartPig Etherfuse account. Must be called before any KYC or order operations.',
  })
  @ApiResponse({
    status: 201,
    description: 'Customer record created',
    schema: {
      example: {
        id: 'cmp63dtnj000jivmcajyxlkpy',
        userId: 'nuw8uz50x4swu6b476uf4lla',
        etherfuseOrgId: '24a382a9-2490-404b-9db3-4a6fb9793719',
        kycStatus: 'NOT_STARTED',
        createdAt: '2026-05-15T12:00:00.000Z',
        updatedAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'User already has an Etherfuse customer record' })
  createCustomer(@Body() dto: CreateEtherfuseCustomerDto) {
    return this.service.createCustomer(dto);
  }

  @Get('etherfuse/onboarding/organization')
  @ApiOperation({ summary: 'Get Etherfuse customer record for the user' })
  @ApiQuery({ name: 'userId', required: true, description: 'Internal SmartPig user ID' })
  @ApiResponse({
    status: 200,
    description: 'Customer record with bank accounts and orders',
    schema: {
      example: {
        id: 'cmp63dtnj000jivmcajyxlkpy',
        userId: 'nuw8uz50x4swu6b476uf4lla',
        etherfuseOrgId: '24a382a9-2490-404b-9db3-4a6fb9793719',
        kycStatus: 'APPROVED',
        createdAt: '2026-05-15T12:00:00.000Z',
        updatedAt: '2026-05-15T12:00:00.000Z',
        bankAccounts: [],
        orders: [],
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Etherfuse customer not found for this user' })
  getCustomer(@Query('userId') userId: string) {
    return this.service.getCustomer(userId);
  }

  // ─── Onboarding: KYC ────────────────────────────────────────────────────────

  @Post('etherfuse/onboarding/kyc')
  @ApiOperation({
    summary: 'Submit KYC identity data (programmatic)',
    description: 'Submit name, address, occupation, and Mexican tax IDs (CURP/RFC) for KYC review.',
  })
  @ApiResponse({
    status: 201,
    description: 'KYC submitted — status updated to PROPOSED',
    schema: {
      example: {
        id: 'cmp63dtnj000jivmcajyxlkpy',
        kycStatus: 'PROPOSED',
        updatedAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Etherfuse customer not found' })
  submitKyc(@Body() dto: SubmitKycDto) {
    return this.service.submitKyc(dto);
  }

  @Post('etherfuse/onboarding/kyc/documents')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload KYC document (selfie, id_front, id_back)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        userId: { type: 'string' },
        pubkey: { type: 'string' },
        documentType: { type: 'string', enum: ['selfie', 'id_front', 'id_back'] },
      },
      required: ['file', 'userId', 'pubkey', 'documentType'],
    },
  })
  @ApiResponse({ status: 201, description: 'Document uploaded successfully', schema: { example: { success: true } } })
  @ApiResponse({ status: 404, description: 'Etherfuse customer not found' })
  uploadKycDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadKycDocumentDto,
  ) {
    return this.service.uploadKycDocument(dto, file.buffer, file.mimetype);
  }

  @Post('etherfuse/onboarding/kyc/status')
  @ApiOperation({ summary: 'Get current KYC status from Etherfuse and sync to DB' })
  @ApiResponse({
    status: 201,
    description: 'Current KYC status',
    schema: {
      example: {
        customerId: '24a382a9-2490-404b-9db3-4a6fb9793719',
        walletPublicKey: 'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
        status: 'approved',
        onChainMarked: true,
        currentRejectionReason: null,
        approvedAt: '2026-05-15T12:00:00.000Z',
        currentKycInfo: {},
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Etherfuse customer not found' })
  getKycStatus(@Body() dto: GetKycStatusDto) {
    return this.service.getKycStatus(dto);
  }

  // ─── Onboarding: Agreements ─────────────────────────────────────────────────

  @Post('etherfuse/onboarding/presigned-url')
  @ApiOperation({
    summary: 'Generate presigned URL for bank account onboarding',
    description: 'Generates a short-lived presigned URL (15 min). Open this URL in a browser/WebView to complete the bank account registration flow on Etherfuse.',
  })
  @ApiResponse({
    status: 201,
    description: 'Presigned URL generated',
    schema: {
      example: {
        presignedUrl: 'https://onboarding.sand.etherfuse.com/session/abc123',
        bankAccountId: '6d3f1ccc-9ef0-4f29-9e75-ff02400e3029',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Etherfuse customer not found' })
  generatePresignedUrl(@Body() dto: GeneratePresignedUrlDto) {
    return this.service.generatePresignedUrl(dto);
  }

  @Post('etherfuse/onboarding/agreements/esign')
  @ApiOperation({ summary: 'Accept electronic signature consent' })
  @ApiResponse({ status: 201, description: 'Agreement accepted', schema: { example: { accepted: true } } })
  acceptEsign(@Body() dto: AcceptAgreementDto) {
    return this.service.acceptElectronicSignature(dto);
  }

  @Post('etherfuse/onboarding/agreements/terms')
  @ApiOperation({ summary: 'Accept terms and conditions' })
  @ApiResponse({ status: 201, description: 'Agreement accepted', schema: { example: { accepted: true } } })
  acceptTerms(@Body() dto: AcceptAgreementDto) {
    return this.service.acceptTermsAndConditions(dto);
  }

  @Post('etherfuse/onboarding/agreements/customer')
  @ApiOperation({ summary: 'Accept customer agreement' })
  @ApiResponse({ status: 201, description: 'Agreement accepted', schema: { example: { accepted: true } } })
  acceptCustomerAgreement(@Body() dto: AcceptAgreementDto) {
    return this.service.acceptCustomerAgreement(dto);
  }

  // ─── Onboarding: Bank Accounts ──────────────────────────────────────────────

  @Post('etherfuse/onboarding/bank-account')
  @ApiOperation({
    summary: 'Register a Mexican bank account (CLABE)',
    description: 'Registers a personal bank account for on/off-ramp. Requires KYC to be in proposed or approved state.',
  })
  @ApiResponse({
    status: 201,
    description: 'Bank account registered',
    schema: {
      example: {
        id: 'cmp6zpoc00001iw7sb4yol9ta',
        customerId: 'cmp63dtnj000jivmcajyxlkpy',
        etherfuseBankId: '6d3f1ccc-9ef0-4f29-9e75-ff02400e3029',
        clabe: '012345678901234567',
        rail: 'spei',
        accountType: 'personal',
        isCompliant: false,
        createdAt: '2026-05-15T12:00:00.000Z',
        updatedAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Etherfuse customer not found' })
  createBankAccount(@Body() dto: CreatePersonalBankAccountDto) {
    return this.service.createBankAccount(dto);
  }

  @Post('etherfuse/onboarding/bank-account/pix')
  @ApiOperation({
    summary: 'Register a Brazilian PIX bank account',
    description: 'Not yet supported by Etherfuse — reserved for future use.',
  })
  @ApiResponse({ status: 400, description: 'PIX bank account registration not yet supported' })
  createPixBankAccount(@Body() dto: CreatePixBankAccountDto) {
    return this.service.createPixBankAccount(dto);
  }

  @Get('etherfuse/onboarding/bank-accounts')
  @ApiOperation({ summary: 'List registered bank accounts (from local DB)' })
  @ApiQuery({ name: 'userId', required: true, description: 'Internal SmartPig user ID' })
  @ApiResponse({
    status: 200,
    description: 'List of bank accounts',
    schema: {
      example: [
        {
          id: 'cmp6zpoc00001iw7sb4yol9ta',
          customerId: 'cmp63dtnj000jivmcajyxlkpy',
          etherfuseBankId: '6d3f1ccc-9ef0-4f29-9e75-ff02400e3029',
          clabe: null,
          pixKey: null,
          rail: 'pix',
          currency: 'brl',
          accountType: 'personal',
          isCompliant: true,
          createdAt: '2026-05-15T12:00:00.000Z',
          updatedAt: '2026-05-15T12:00:00.000Z',
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Etherfuse customer not found' })
  listBankAccounts(@Query('userId') userId: string) {
    return this.service.listBankAccounts(userId);
  }

  @Post('etherfuse/onboarding/bank-accounts/sync')
  @ApiOperation({
    summary: 'Sync bank accounts from Etherfuse into local DB',
    description: 'Fetches all bank accounts from Etherfuse and upserts them locally. Use this after completing the presigned URL flow.',
  })
  @ApiResponse({
    status: 201,
    description: 'Synced bank accounts',
    schema: {
      example: [
        {
          id: 'cmp6zpoc00001iw7sb4yol9ta',
          etherfuseBankId: '6d3f1ccc-9ef0-4f29-9e75-ff02400e3029',
          rail: 'pix',
          accountType: 'personal',
          isCompliant: true,
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Etherfuse customer not found' })
  syncBankAccounts(@Body() dto: UserIdDto) {
    return this.service.syncBankAccounts(dto.userId);
  }

  // ─── Assets ─────────────────────────────────────────────────────────────────

  @Get('etherfuse/assets')
  @ApiOperation({
    summary: 'List available assets for on/off-ramp',
    description: 'Returns available crypto and fiat assets for the given blockchain and currency.',
  })
  @ApiQuery({ name: 'currency', required: true, description: 'Fiat currency code (e.g. brl, mxn)' })
  @ApiResponse({ status: 200, description: 'List of available assets' })
  listAssets(
    @Query('currency') currency: string,
    @Query('wallet') wallet?: string,
  ) {
    return this.service.listAssets('stellar', currency, wallet);
  }

  // ─── Quotes ─────────────────────────────────────────────────────────────────

  @Post('etherfuse/quote')
  @ApiOperation({
    summary: 'Get a conversion quote (onramp or offramp)',
    description: 'Quotes expire after 2 minutes. Use the quoteId immediately when creating an order.',
  })
  @ApiResponse({
    status: 201,
    description: 'Quote created',
    schema: {
      example: {
        quoteId: '86119884-fa4f-4e03-924b-3602edc9a216',
        blockchain: 'stellar',
        quoteAssets: { type: 'offramp', sourceAsset: 'USDC:GBBD47IF...', targetAsset: 'BRL' },
        sourceAmount: '20',
        destinationAmount: '101.17943',
        exchangeRate: '5.05897',
        feeBps: '50',
        feeAmount: '0.10',
        expiresAt: '2026-05-15T12:02:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Etherfuse customer not found' })
  getQuote(@Body() dto: GetEtherfuseQuoteDto) {
    return this.service.getQuote(dto);
  }

  // ─── Orders ─────────────────────────────────────────────────────────────────

  @Post('etherfuse/onramp')
  @ApiOperation({
    summary: 'Create an on-ramp order (fiat → crypto on Stellar)',
    description: 'Creates an order from a previously obtained quote. The user must send fiat to the returned deposit instructions.',
  })
  @ApiResponse({
    status: 201,
    description: 'On-ramp order created',
    schema: {
      example: {
        id: 'cmp75pttw0001r61fbdx2c44c',
        idempotencyKey: 'd40764e2-9c5a-4a8a-b4c2-b08a98fc1417',
        etherfuseOrderId: 'd40764e2-9c5a-4a8a-b4c2-b08a98fc1417',
        direction: 'ONRAMP',
        status: 'PROCESSING',
        sourceAsset: 'BRL',
        targetAsset: 'USDC:GBBD47IF...',
        sourceAmount: '50',
        destinationAmount: '9.88',
        walletAddress: 'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
        createdAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bank account not compliant' })
  @ApiResponse({ status: 404, description: 'Bank account not found' })
  createOnramp(@Body() dto: CreateEtherfuseOnrampDto) {
    return this.service.createOnramp(dto);
  }

  @Post('etherfuse/offramp')
  @ApiOperation({
    summary: 'Create an off-ramp order (crypto on Stellar → fiat)',
    description: 'Creates an off-ramp order. Returns an unsigned Stellar burn XDR (`unsignedBurnXdr`) that the mobile client must sign and submit via `POST /etherfuse/offramp/:id/submit`. If `unsignedBurnXdr` is null, call `POST /etherfuse/offramp/:id/refresh-xdr`.',
  })
  @ApiResponse({
    status: 201,
    description: 'Off-ramp order created',
    schema: {
      example: {
        id: 'cmp76s5ea0001iv23vxyvn2b9',
        status: 'PENDING_SIGNATURE',
        sourceAmount: '20',
        destinationAmount: '101.17943',
        unsignedBurnXdr: 'AAAAAgAAAABCiuW9b8jMMgfK+MJ7...',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bank account not compliant' })
  @ApiResponse({ status: 404, description: 'Bank account not found' })
  createOfframp(@Body() dto: CreateEtherfuseOfframpDto) {
    return this.service.createOfframp(dto);
  }

  @Post('etherfuse/offramp/:id/refresh-xdr')
  @ApiOperation({
    summary: 'Refresh unsigned burn XDR for an off-ramp order',
    description: 'Fetches the latest order details from Etherfuse and updates `unsignedBurnXdr` in the DB. Use when the XDR was null at order creation time.',
  })
  @ApiParam({ name: 'id', description: 'Internal order ID or Etherfuse order ID' })
  @ApiResponse({
    status: 201,
    description: 'XDR fetched and saved',
    schema: {
      example: {
        id: 'cmp76s5ea0001iv23vxyvn2b9',
        status: 'PENDING_SIGNATURE',
        sourceAmount: '20',
        destinationAmount: '101.17943',
        unsignedBurnXdr: 'AAAAAgAAAABCiuW9b8jMMgfK+MJ7...',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Order not found or XDR not yet available' })
  refreshOfframpXdr(
    @Param('id') id: string,
    @Body() dto: UserIdDto,
  ) {
    return this.service.refreshOfframpXdr(id, dto.userId);
  }

  @Post('etherfuse/offramp/:id/submit')
  @ApiOperation({
    summary: 'Submit signed burn XDR for off-ramp',
    description: 'After signing the `unsignedBurnXdr` with the user\'s Stellar wallet, submit the signed XDR here to complete the off-ramp.',
  })
  @ApiParam({ name: 'id', description: 'Internal order ID' })
  @ApiResponse({
    status: 201,
    description: 'Signed XDR recorded — order moved to PROCESSING',
    schema: {
      example: {
        id: 'cmp76s5ea0001iv23vxyvn2b9',
        status: 'PROCESSING',
        signedBurnXdr: 'AAAAAgAAAABCiuW9...',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Order is not in PENDING_SIGNATURE status' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  submitOfframp(
    @Param('id') id: string,
    @Body() dto: SubmitEtherfuseOfframpDto & { userId: string },
  ) {
    return this.service.submitOfframp(id, dto.userId, dto);
  }

  @Get('etherfuse/orders/:id')
  @ApiOperation({ summary: 'Get order details' })
  @ApiParam({ name: 'id', description: 'Internal order ID or Etherfuse order ID' })
  @ApiQuery({ name: 'userId', required: true, description: 'Internal SmartPig user ID' })
  @ApiResponse({
    status: 200,
    description: 'Order details',
    schema: {
      example: {
        id: 'cmp76s5ea0001iv23vxyvn2b9',
        etherfuseOrderId: '290799cf-6849-457f-ad4a-ae9622f7797f',
        direction: 'OFFRAMP',
        status: 'PENDING_SIGNATURE',
        sourceAsset: 'USDC:GBBD47IF...',
        targetAsset: 'BRL',
        sourceAmount: '20',
        destinationAmount: '101.17943',
        walletAddress: 'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
        unsignedBurnXdr: 'AAAAAgAAAABCiuW9...',
        signedBurnXdr: null,
        createdAt: '2026-05-15T12:00:00.000Z',
        updatedAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  getOrder(@Param('id') id: string, @Query('userId') userId: string) {
    return this.service.getOrder(id, userId);
  }

  // ─── Sandbox ────────────────────────────────────────────────────────────────

  @Post('etherfuse/sandbox/onramp/:id/simulate-payment')
  @ApiOperation({
    summary: '[SANDBOX/DEVNET ONLY] Simulate fiat payment received for an on-ramp order',
    description: 'Triggers `POST /ramp/order/fiat_received` on the Etherfuse sandbox/devnet to advance the order to COMPLETED. Only available in test environments.',
  })
  @ApiParam({ name: 'id', description: 'Internal order ID or Etherfuse order ID' })
  @ApiResponse({
    status: 201,
    description: 'Payment simulated',
    schema: {
      example: {
        simulated: true,
        orderId: 'cmp75pttw0001r61fbdx2c44c',
        etherfuseOrderId: 'd40764e2-9c5a-4a8a-b4c2-b08a98fc1417',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Order is not an on-ramp' })
  @ApiResponse({ status: 403, description: 'Only available in test environments' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  sandboxSimulatePayment(
    @Param('id') id: string,
    @Body() dto: UserIdDto,
  ) {
    return this.service.sandboxSimulatePayment(id, dto.userId);
  }

  // ─── Webhook (public, signature-verified) ───────────────────────────────────

  @Post('webhooks/etherfuse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Etherfuse webhook handler',
    description: 'Internal endpoint for Etherfuse event notifications (order_updated, kyc_updated, bank_account_updated). Signature verified via X-Signature header (RFC 8785 JCS + HMAC-SHA256).',
  })
  @ApiResponse({ status: 200, description: 'Event received', schema: { example: { received: true } } })
  @ApiResponse({ status: 401, description: 'Invalid or missing webhook signature' })
  async handleEtherfuseWebhook(
    @Req() req: Request,
    @Headers('x-signature') signature: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.verifyWebhookSignature(body, signature);

    const eventType = body['eventType'] as string | undefined;

    if (eventType === 'order_updated') {
      const order = body['order'] as Record<string, unknown> | undefined;
      if (order?.['id'] && order?.['status']) {
        await this.service.handleOrderUpdated(
          order['id'] as string,
          order['status'] as string,
        );
      }
    } else if (eventType === 'kyc_updated') {
      const kycData = body['kyc_updated'] as Record<string, unknown> | undefined;
      if (kycData?.['customerId'] !== undefined) {
        await this.service.handleKycUpdated(
          kycData['customerId'] as string,
          kycData['approved'] as boolean,
        );
      }
    } else if (eventType === 'bank_account_updated') {
      const account = body['bankAccount'] as Record<string, unknown> | undefined;
      if (account?.['id'] !== undefined) {
        await this.service.handleBankAccountUpdated(
          account['id'] as string,
          account['compliant'] as boolean,
        );
      }
    }

    return { received: true };
  }

  private verifyWebhookSignature(body: Record<string, unknown>, signature: string) {
    const secret = this.config.get<string>('ETHERFUSE_WEBHOOK_SECRET');
    if (!secret) return; // Skip in development if not configured

    if (!signature) {
      throw new UnauthorizedException('Missing X-Signature header');
    }

    // RFC 8785 JCS canonicalization
    const canonicalized = canonicalize(body) ?? '';
    const key = Buffer.from(secret, 'base64');
    const hmac = createHmac('sha256', key).update(canonicalized).digest('hex');
    const expected = `sha256=${hmac}`;

    if (
      expected.length !== signature.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}
