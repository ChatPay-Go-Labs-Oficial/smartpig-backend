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
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

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
  uploadKycFile(@UploadedFile() file: Express.Multer.File) {
    return this.rampService
      .uploadKycFile(file.buffer, file.originalname, file.mimetype)
      .then((url) => ({ url }));
  }

  // ─── Receiver ───────────────────────────────────────────────────────────────

  @Post('ramp/receiver')
  createReceiver(@Body() dto: CreateReceiverDto) {
    return this.rampService.createReceiver(dto);
  }

  @Get('ramp/receiver')
  getReceiver(@Body('userId') userId: string) {
    return this.rampService.getReceiver(userId);
  }

  // ─── Bank Accounts ──────────────────────────────────────────────────────────

  @Post('ramp/receiver/bank-accounts')
  createBankAccount(@Body() dto: CreateBankAccountDto) {
    return this.rampService.createBankAccount(dto);
  }

  @Get('ramp/receiver/bank-accounts')
  listBankAccounts(@Body('userId') userId: string) {
    return this.rampService.listBankAccounts(userId);
  }

  // ─── Blockchain Wallets ─────────────────────────────────────────────────────

  @Post('ramp/receiver/wallets')
  createBlockchainWallet(@Body() dto: CreateBlockchainWalletDto) {
    return this.rampService.createBlockchainWallet(dto);
  }

  // ─── On-ramp ────────────────────────────────────────────────────────────────

  @Post('ramp/onramp/quote')
  getOnrampQuote(@Body() dto: OnrampQuoteDto) {
    return this.rampService.getOnrampQuote(dto);
  }

  @Post('ramp/onramp')
  createOnramp(@Body() dto: CreateOnrampDto) {
    return this.rampService.createOnramp(dto);
  }

  @Get('ramp/onramp/:id')
  getOnramp(@Param('id') id: string, @Body('userId') userId: string) {
    return this.rampService.getOnramp(id, userId);
  }

  // ─── Off-ramp ───────────────────────────────────────────────────────────────

  @Post('ramp/offramp/quote')
  getOfframpQuote(@Body() dto: OfframpQuoteDto) {
    return this.rampService.getOfframpQuote(dto);
  }

  @Post('ramp/offramp')
  createOfframp(@Body() dto: CreateOfframpDto) {
    return this.rampService.createOfframp(dto);
  }

  @Post('ramp/offramp/:id/submit')
  submitOfframp(
    @Param('id') id: string,
    @Body() dto: SubmitOfframpDto & { userId: string },
  ) {
    return this.rampService.submitOfframp(id, dto.userId, dto);
  }

  @Get('ramp/offramp/:id')
  getOfframp(@Param('id') id: string, @Body('userId') userId: string) {
    return this.rampService.getOfframp(id, userId);
  }

  // ─── Webhook (public, HMAC-verified) ────────────────────────────────────────

  @Post('webhooks/blindpay')
  @HttpCode(HttpStatus.OK)
  async handleBlindPayWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('blindpay-signature') signature: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.verifyWebhookSignature(req.rawBody, signature);

    const event = body['webhook_event'] as string | undefined;
    if (event?.startsWith('payin.')) {
      await this.rampService.handlePayinWebhook(body['id'] as string, body['status'] as string);
    } else if (event?.startsWith('payout.')) {
      await this.rampService.handlePayoutWebhook(body['id'] as string, body['status'] as string);
    }

    return { received: true };
  }

  private verifyWebhookSignature(rawBody: Buffer | undefined, signature: string) {
    const secret = this.config.get<string>('BLINDPAY_WEBHOOK_SECRET');
    if (!secret) return; // Skip verification if secret not configured

    if (!signature || !rawBody) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const expectedSig = createHmac('sha256', secret).update(rawBody).digest('hex');
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
