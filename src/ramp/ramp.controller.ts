import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { RampService } from './ramp.service';
import {
  CreateBankAccountDto,
  CreateBlockchainWalletDto,
  CreateOfframpDto,
  CreateOnrampDto,
  CreateReceiverDto,
  InitiateTosDto,
  OfframpQuoteDto,
  OnrampQuoteDto,
  SubmitOfframpDto,
} from './dto/ramp.dto';

@ApiTags('Ramp')
@Controller()
export class RampController {
  constructor(
    private readonly rampService: RampService,
    private readonly config: ConfigService,
  ) {}

  // ─── Terms of Service ───────────────────────────────────────────────────────

  /**
   * Initiate BlindPay Terms of Service session.
   * Returns { tosUrl } — open this URL in a WebView/browser.
   * After acceptance, BlindPay redirects to redirectUrl?tos_id=to_XXXXXXXXXXXX.
   * Pass that tos_id in POST /ramp/receiver.
   */
  @Post('ramp/tos')
  @ApiOperation({
    summary: 'Initiate BlindPay ToS',
    description:
      'Starts a Terms of Service session. Returns a URL that must be opened in a browser/WebView.',
  })
  initiateTos(@Body() dto: InitiateTosDto) {
    return this.rampService.initiateTos(dto);
  }

  // ─── KYC File Upload ────────────────────────────────────────────────────────

  /**
   * Upload a KYC document (selfie, ID front/back) to BlindPay.
   * Returns the hosted URL to be used in POST /ramp/receiver.
   *
   * multipart/form-data field name: "file"
   */
  @Post('ramp/upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload KYC document',
    description:
      'Uploads a file for KYC purposes. Returns the hosted URL for the document.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  uploadKycFile(@UploadedFile() file: Express.Multer.File) {
    return this.rampService
      .uploadKycFile(file.buffer, file.originalname, file.mimetype)
      .then((url) => ({ url }));
  }

  // ─── Receiver ───────────────────────────────────────────────────────────────

  @Post('ramp/receiver')
  @ApiOperation({ summary: 'Create a BlindPay receiver' })
  createReceiver(@Body() dto: CreateReceiverDto) {
    return this.rampService.createReceiver(dto);
  }

  @Get('ramp/receiver')
  @ApiOperation({ summary: 'Get receiver details' })
  getReceiver(@Body('userId') userId: string) {
    return this.rampService.getReceiver(userId);
  }

  // ─── Bank Accounts ──────────────────────────────────────────────────────────

  @Post('ramp/receiver/bank-accounts')
  @ApiOperation({ summary: 'Add a bank account to a receiver' })
  createBankAccount(@Body() dto: CreateBankAccountDto) {
    return this.rampService.createBankAccount(dto);
  }

  @Get('ramp/receiver/bank-accounts')
  @ApiOperation({ summary: 'List bank accounts for a receiver' })
  listBankAccounts(@Body('userId') userId: string) {
    return this.rampService.listBankAccounts(userId);
  }

  // ─── Blockchain Wallets ─────────────────────────────────────────────────────

  @Post('ramp/receiver/wallets')
  @ApiOperation({ summary: 'Add a blockchain wallet to a receiver' })
  createBlockchainWallet(@Body() dto: CreateBlockchainWalletDto) {
    return this.rampService.createBlockchainWallet(dto);
  }

  // ─── On-ramp ────────────────────────────────────────────────────────────────

  @Post('ramp/onramp/quote')
  @ApiOperation({ summary: 'Get an on-ramp quote' })
  getOnrampQuote(@Body() dto: OnrampQuoteDto) {
    return this.rampService.getOnrampQuote(dto);
  }

  @Post('ramp/onramp')
  @ApiOperation({ summary: 'Create an on-ramp transaction' })
  createOnramp(@Body() dto: CreateOnrampDto) {
    return this.rampService.createOnramp(dto);
  }

  @Get('ramp/onramp/:id')
  @ApiOperation({ summary: 'Get on-ramp transaction details' })
  getOnramp(@Param('id') id: string, @Body('userId') userId: string) {
    return this.rampService.getOnramp(id, userId);
  }

  // ─── Off-ramp ───────────────────────────────────────────────────────────────

  @Post('ramp/offramp/quote')
  @ApiOperation({ summary: 'Get an off-ramp quote' })
  getOfframpQuote(@Body() dto: OfframpQuoteDto) {
    return this.rampService.getOfframpQuote(dto);
  }

  @Post('ramp/offramp')
  @ApiOperation({ summary: 'Create an off-ramp transaction' })
  createOfframp(@Body() dto: CreateOfframpDto) {
    return this.rampService.createOfframp(dto);
  }

  @Post('ramp/offramp/:id/delegation')
  @ApiOperation({
    summary: 'Refresh delegation XDR (when previous one expired)',
  })
  refreshOfframpDelegation(
    @Param('id') id: string,
    @Body('userId') userId: string,
  ) {
    return this.rampService.refreshOfframpDelegation(id, userId);
  }

  @Post('ramp/offramp/:id/submit')
  @ApiOperation({ summary: 'Submit signed XDR for off-ramp' })
  submitOfframp(@Param('id') id: string, @Body() dto: SubmitOfframpDto) {
    return this.rampService.submitOfframp(id, dto.userId, dto);
  }

  @Get('ramp/offramp/:id')
  @ApiOperation({ summary: 'Get off-ramp transaction details' })
  getOfframp(@Param('id') id: string, @Body('userId') userId: string) {
    return this.rampService.getOfframp(id, userId);
  }

  // ─── Webhook (public, HMAC-verified) ────────────────────────────────────────

  @Post('webhooks/blindpay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'BlindPay webhook handler',
    description: 'Internal endpoint for BlindPay notifications.',
  })
  async handleBlindPayWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('blindpay-signature') signature: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.verifyWebhookSignature(req.rawBody, signature);

    const event = body['webhook_event'] as string | undefined;
    if (event?.startsWith('payin.')) {
      await this.rampService.handlePayinWebhook(
        body['id'] as string,
        body['status'] as string,
      );
    } else if (event?.startsWith('payout.')) {
      await this.rampService.handlePayoutWebhook(
        body['id'] as string,
        body['status'] as string,
      );
    }

    return { received: true };
  }

  private verifyWebhookSignature(
    rawBody: Buffer | undefined,
    signature: string,
  ) {
    const secret = this.config.get<string>('BLINDPAY_WEBHOOK_SECRET');
    if (!secret) return; // Skip verification if secret not configured

    if (!signature || !rawBody) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const expectedSig = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    const sigBuffer = Buffer.from(signature.replace(/^sha256=/, ''));
    const expectedBuffer = Buffer.from(expectedSig);

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}
