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
  createCustomer(@Body() dto: CreateEtherfuseCustomerDto) {
    return this.service.createCustomer(dto);
  }

  @Get('etherfuse/onboarding/organization')
  @ApiOperation({ summary: 'Get Etherfuse customer record for the user' })
  getCustomer(@Query('userId') userId: string) {
    return this.service.getCustomer(userId);
  }

  // ─── Onboarding: KYC ────────────────────────────────────────────────────────

  @Post('etherfuse/onboarding/kyc')
  @ApiOperation({
    summary: 'Submit KYC identity data (programmatic)',
    description: 'Submit name, address, occupation, and Mexican tax IDs (CURP/RFC) for KYC review.',
  })
  submitKyc(@Body() dto: SubmitKycDto) {
    return this.service.submitKyc(dto);
  }

  @Post('etherfuse/onboarding/kyc/documents')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload KYC document (selfie, id_front, id_back)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        userId: { type: 'string' },
        pubkey: { type: 'string' },
        documentType: { type: 'string', enum: ['selfie', 'id_front', 'id_back'] },
      },
    },
  })
  uploadKycDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadKycDocumentDto,
  ) {
    return this.service.uploadKycDocument(dto, file.buffer, file.mimetype);
  }

  @Post('etherfuse/onboarding/kyc/status')
  @ApiOperation({ summary: 'Get current KYC status' })
  getKycStatus(@Body() dto: GetKycStatusDto) {
    return this.service.getKycStatus(dto);
  }

  // ─── Onboarding: Agreements ─────────────────────────────────────────────────

  @Post('etherfuse/onboarding/presigned-url')
  @ApiOperation({
    summary: 'Generate presigned URL for agreement signing',
    description: 'Generates a short-lived presigned URL (15 min) needed to accept the 3 agreements. Requires a registered bank account.',
  })
  generatePresignedUrl(@Body() dto: GeneratePresignedUrlDto) {
    return this.service.generatePresignedUrl(dto);
  }

  @Post('etherfuse/onboarding/agreements/esign')
  @ApiOperation({ summary: 'Accept electronic signature consent' })
  acceptEsign(@Body() dto: AcceptAgreementDto) {
    return this.service.acceptElectronicSignature(dto);
  }

  @Post('etherfuse/onboarding/agreements/terms')
  @ApiOperation({ summary: 'Accept terms and conditions' })
  acceptTerms(@Body() dto: AcceptAgreementDto) {
    return this.service.acceptTermsAndConditions(dto);
  }

  @Post('etherfuse/onboarding/agreements/customer')
  @ApiOperation({ summary: 'Accept customer agreement' })
  acceptCustomerAgreement(@Body() dto: AcceptAgreementDto) {
    return this.service.acceptCustomerAgreement(dto);
  }

  // ─── Onboarding: Bank Accounts ──────────────────────────────────────────────

  @Post('etherfuse/onboarding/bank-account')
  @ApiOperation({
    summary: 'Register a Mexican bank account (CLABE)',
    description: 'Registers a personal bank account for on/off-ramp. Requires KYC to be in proposed or approved state.',
  })
  createBankAccount(@Body() dto: CreatePersonalBankAccountDto) {
    return this.service.createBankAccount(dto);
  }

  @Post('etherfuse/onboarding/bank-account/pix')
  @ApiOperation({
    summary: 'Register a Brazilian PIX bank account',
    description: 'Registers a PIX key for BRL on/off-ramp. Requires a valid presigned URL and CPF.',
  })
  createPixBankAccount(@Body() dto: CreatePixBankAccountDto) {
    return this.service.createPixBankAccount(dto);
  }

  @Get('etherfuse/onboarding/bank-accounts')
  @ApiOperation({ summary: 'List registered bank accounts' })
  listBankAccounts(@Query('userId') userId: string) {
    return this.service.listBankAccounts(userId);
  }

  @Post('etherfuse/onboarding/bank-accounts/sync')
  @ApiOperation({
    summary: 'Sync bank accounts from Etherfuse',
    description: 'Fetches all bank accounts registered in Etherfuse and upserts them into the local database. Useful when an account was created via the presigned URL flow and was not persisted locally.',
  })
  syncBankAccounts(@Body() dto: UserIdDto) {
    return this.service.syncBankAccounts(dto.userId);
  }

  // ─── Quotes ─────────────────────────────────────────────────────────────────

  @Post('etherfuse/quote')
  @ApiOperation({
    summary: 'Get a conversion quote (onramp or offramp)',
    description: 'Quotes expire after 2 minutes. Use the quoteId immediately when creating an order.',
  })
  getQuote(@Body() dto: GetEtherfuseQuoteDto) {
    return this.service.getQuote(dto);
  }

  // ─── Orders ─────────────────────────────────────────────────────────────────

  @Post('etherfuse/onramp')
  @ApiOperation({
    summary: 'Create an on-ramp order (MXN → crypto on Stellar)',
    description: 'Creates an order from a previously obtained quote. Returns deposit instructions for the fiat transfer.',
  })
  createOnramp(@Body() dto: CreateEtherfuseOnrampDto) {
    return this.service.createOnramp(dto);
  }

  @Post('etherfuse/offramp')
  @ApiOperation({
    summary: 'Create an off-ramp order (crypto on Stellar → MXN)',
    description: 'Returns an unsigned Stellar burn transaction XDR. The mobile client must sign it and submit via POST /etherfuse/offramp/:id/submit.',
  })
  createOfframp(@Body() dto: CreateEtherfuseOfframpDto) {
    return this.service.createOfframp(dto);
  }

  @Post('etherfuse/offramp/:id/refresh-xdr')
  @ApiOperation({
    summary: 'Refresh unsigned burn XDR for an off-ramp order',
    description: 'Fetches the latest order details from Etherfuse and updates the unsignedBurnXdr in the database. Use when the XDR was not returned at order creation time.',
  })
  refreshOfframpXdr(
    @Param('id') id: string,
    @Body() dto: UserIdDto,
  ) {
    return this.service.refreshOfframpXdr(id, dto.userId);
  }

  @Post('etherfuse/offramp/:id/submit')
  @ApiOperation({
    summary: 'Submit signed burn XDR for off-ramp',
    description: 'Provide the XDR signed by the user\'s Stellar wallet to proceed with the off-ramp.',
  })
  submitOfframp(
    @Param('id') id: string,
    @Body() dto: SubmitEtherfuseOfframpDto & { userId: string },
  ) {
    return this.service.submitOfframp(id, dto.userId, dto);
  }

  @Get('etherfuse/orders/:id')
  @ApiOperation({ summary: 'Get order details' })
  getOrder(@Param('id') id: string, @Query('userId') userId: string) {
    return this.service.getOrder(id, userId);
  }

  // ─── Sandbox ────────────────────────────────────────────────────────────────

  @Post('etherfuse/sandbox/onramp/:id/simulate-payment')
  @ApiOperation({
    summary: '[SANDBOX ONLY] Simulate fiat payment received for an on-ramp order',
    description: 'Triggers the Etherfuse sandbox endpoint `POST /ramp/order/fiat_received` to advance the order. Only works when ETHERFUSE_BASE_URL points to the sandbox environment.',
  })
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
