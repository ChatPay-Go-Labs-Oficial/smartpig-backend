import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
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
import { Public } from '../auth/privy/public.decorator';
import { RampService } from './ramp.service';
import { RampKycService } from './kyc.service';
import {
  CreateBankAccountDto,
  CreateBlockchainWalletDto,
  CreateOfframpDto,
  CreateOnrampDto,
  CreateReceiverDto,
  InitiateTosDto,
  OfframpQuoteDto,
  OnrampQuoteDto,
  ResubmitReceiverDto,
  SubmitOfframpDto,
  SubmitRfiDto,
} from './dto/ramp.dto';

/** Limites de upload da BlindPay, replicados para falhar antes do round-trip. */
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const ALLOWED_UPLOAD_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];

@ApiTags('Ramp')
@Controller()
export class RampController {
  private readonly logger = new Logger(RampController.name);

  constructor(
    private readonly rampService: RampService,
    private readonly kycService: RampKycService,
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
    // Sem esses guards, um request sem arquivo estoura TypeError em `file.buffer`
    // e vira 500. Os limites são os mesmos que a BlindPay aplica — falhar aqui
    // poupa o round-trip e devolve uma mensagem que o usuário entende.
    if (!file?.buffer?.length) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'UPLOAD_MISSING_FILE',
        message: 'Nenhum arquivo foi enviado no campo "file".',
      });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'UPLOAD_TOO_LARGE',
        message: `O arquivo excede o limite de ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
      });
    }
    if (!ALLOWED_UPLOAD_MIMES.includes(file.mimetype)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'UPLOAD_BAD_TYPE',
        message: 'Formato não aceito. Envie uma imagem JPG ou PNG, ou um PDF.',
      });
    }

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
  getReceiver(@Query('userId') userId: string) {
    return this.rampService.getReceiver(userId);
  }

  // ─── KYC ────────────────────────────────────────────────────────────────────

  @Get('ramp/receiver/kyc-status')
  @ApiOperation({
    summary: 'Get live KYC status from BlindPay',
    description:
      'Fetches kyc_status from BlindPay, persists it locally and returns the open RFI when there is one. This is the endpoint the app polls while KYC is pending.',
  })
  getKycStatus(@Query('userId') userId: string) {
    return this.kycService.getKycStatus(userId);
  }

  @Post('ramp/receiver/resubmit')
  @ApiOperation({
    summary: 'Redo KYC after a rejection',
    description:
      'BlindPay does not allow editing a rejected customer, so this creates a new one and re-registers the Pix account and blockchain wallet against it. Only allowed while kycStatus is REJECTED.',
  })
  resubmitReceiver(@Body() dto: ResubmitReceiverDto) {
    return this.kycService.resubmitReceiver(dto);
  }

  @Get('ramp/receiver/rfi')
  @ApiOperation({
    summary: 'Get the open Request for Information',
    description: 'Returns null when compliance has no pending request.',
  })
  getRfi(@Query('userId') userId: string) {
    return this.kycService.getRfi(userId);
  }

  @Post('ramp/receiver/rfi')
  @ApiOperation({
    summary: 'Answer the open Request for Information',
    description:
      'Validates the answers against the requested fields before forwarding. Submission is single-shot — partial answers are not accepted by BlindPay.',
  })
  submitRfi(@Body() dto: SubmitRfiDto) {
    return this.kycService.submitRfi(dto.userId, dto.responses);
  }

  // ─── Bank Accounts ──────────────────────────────────────────────────────────

  @Post('ramp/receiver/bank-accounts')
  @ApiOperation({ summary: 'Add a bank account to a receiver' })
  createBankAccount(@Body() dto: CreateBankAccountDto) {
    return this.rampService.createBankAccount(dto);
  }

  @Get('ramp/receiver/bank-accounts')
  @ApiOperation({ summary: 'List bank accounts for a receiver' })
  listBankAccounts(@Query('userId') userId: string) {
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
  getOnramp(@Param('id') id: string, @Query('userId') userId: string) {
    return this.rampService.getOnramp(id, userId);
  }

  @Post('ramp/onramp/:id/sync')
  @ApiOperation({
    summary: 'Sync on-ramp status from BlindPay',
    description:
      'Fetches the latest payin status directly from BlindPay and updates the local database. Useful when webhooks are not configured or in development.',
  })
  syncOnramp(@Param('id') id: string, @Body('userId') userId: string) {
    return this.rampService.syncOnrampFromBlindPay(id, userId);
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
  getOfframp(@Param('id') id: string, @Query('userId') userId: string) {
    return this.rampService.getOfframp(id, userId);
  }

  @Post('ramp/offramp/:id/sync')
  @ApiOperation({
    summary: 'Sync off-ramp status from BlindPay',
    description:
      'Fetches the latest payout status directly from BlindPay and updates the local database. Useful when webhooks are not configured or in development.',
  })
  syncOfframp(@Param('id') id: string, @Body('userId') userId: string) {
    return this.rampService.syncOfframpFromBlindPay(id, userId);
  }

  // ─── Webhook (public, Svix-verified) ────────────────────────────────────────

  @Public()
  @Post('webhooks/blindpay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'BlindPay webhook handler',
    description: 'Internal endpoint for BlindPay notifications.',
  })
  async handleBlindPayWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.verifyWebhookSignature(
      req.rawBody,
      svixId,
      svixTimestamp,
      svixSignature,
    );

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
    } else if (event === 'customer.new' || event === 'customer.update') {
      // Único aviso proativo de aprovação, rejeição ou abertura de RFI.
      // `id` aqui é o customer da BlindPay (`re_...`), não o id local.
      await this.kycService.applyWebhookStatus(
        body['id'] as string,
        body['kyc_status'] as string | undefined,
        body['kyc_warnings'] ?? body['fraud_warnings'],
      );
    }

    return { received: true };
  }

  /**
   * BlindPay signs webhooks using the Svix scheme (svix-id/svix-timestamp/svix-signature
   * headers). Implementation follows BlindPay's own reference example verbatim
   * (blindpay.com/docs/learn/webhooks-verification) — do not swap this for a
   * generic "blindpay-signature" HMAC check, that header does not exist.
   */
  private verifyWebhookSignature(
    rawBody: Buffer | undefined,
    svixId: string,
    svixTimestamp: string,
    svixSignature: string,
  ) {
    const secret = this.config.get<string>('BLINDPAY_WEBHOOK_SECRET');
    if (!secret) {
      // Sem secret não há como distinguir a BlindPay de qualquer um na internet,
      // e este endpoint muda kyc_status e libera saque. Em produção isso é uma
      // porta aberta, então falha fechado; fora dela o bypass segue valendo para
      // não travar o desenvolvimento local, mas ruidosamente.
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new UnauthorizedException('Webhook secret not configured');
      }
      this.logger.warn(
        'BLINDPAY_WEBHOOK_SECRET ausente — assinatura do webhook NÃO verificada',
      );
      return;
    }

    if (!svixId || !svixTimestamp || !svixSignature || !rawBody) {
      throw new UnauthorizedException('Missing webhook signature headers');
    }

    const toleranceInSeconds = 5 * 60;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(svixTimestamp)) > toleranceInSeconds) {
      throw new UnauthorizedException(
        'Webhook timestamp outside tolerance window',
      );
    }

    const signedContent = `${svixId}.${svixTimestamp}.${rawBody.toString('utf8')}`;
    const secretBytes = Buffer.from(secret.split('_')[1], 'base64');
    const expectedSignature = createHmac('sha256', secretBytes)
      .update(signedContent)
      .digest('base64');

    const signatures = svixSignature.split(' ').map((sig) => sig.split(',')[1]);
    const isValid = signatures.some((sig) => {
      try {
        return timingSafeEqual(
          Buffer.from(sig, 'base64'),
          Buffer.from(expectedSignature, 'base64'),
        );
      } catch {
        return false;
      }
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}
