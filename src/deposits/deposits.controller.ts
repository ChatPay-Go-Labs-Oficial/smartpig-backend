import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { DepositsService } from './deposits.service';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { SubmitSignedXdrDto } from './dto/submit-signed-xdr.dto';

class ListDepositsQuery {
  @ApiProperty({ description: 'The ID of the user whose deposits to list' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

@ApiTags('Deposits')
@Controller('deposits')
export class DepositsController {
  constructor(private readonly depositsService: DepositsService) {}

  /**
   * POST /deposits
   * Create a deposit intent and receive an unsigned XDR to sign on the client.
   */
  @Post()
  @ApiOperation({
    summary: 'Create a deposit intent',
    description:
      'Creates a deposit intent and returns an unsigned Stellar transaction (XDR) that must be signed by the user.',
  })
  @ApiResponse({
    status: 201,
    description: 'Deposit intent created. The unsignedXdr must be signed by the user and submitted back.',
    schema: {
      example: {
        id: 'cmp7deposit001',
        idempotencyKey: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
        userId: 'nuw8uz50x4swu6b476uf4lla',
        walletAccountId: 'cmp63d000jivmcajyxlkpy',
        vaultId: 'cmp6vault001',
        amount: '100.50',
        assetSymbol: 'USDC',
        status: 'XDR_GENERATED',
        unsignedXdr: 'AAAAAgAAAAB...',
        createdAt: '2026-05-15T12:00:00.000Z',
        updatedAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request body (e.g. missing amount, vaultId, or walletAccountId).' })
  @ApiResponse({ status: 404, description: 'Vault or wallet not found.' })
  @ApiResponse({ status: 409, description: 'Duplicate idempotency key — a deposit with this key already exists.' })
  createDeposit(@Body() dto: CreateDepositDto) {
    return this.depositsService.createDeposit(dto);
  }

  /**
   * POST /deposits/:id/signed-xdr
   * Submit the signed XDR back to the backend for broadcast to Stellar.
   */
  @Post(':id/signed-xdr')
  @ApiOperation({
    summary: 'Submit signed transaction',
    description:
      'Submits a signed Stellar transaction (XDR) for a specific deposit intent to be broadcasted to the network.',
  })
  @ApiParam({ name: 'id', description: 'Deposit intent ID (cuid)', example: 'cmp7deposit001' })
  @ApiResponse({
    status: 201,
    description: 'Signed XDR accepted and submitted to the Stellar network.',
    schema: {
      example: {
        id: 'cmp7deposit001',
        status: 'SUBMITTED',
        updatedAt: '2026-05-15T12:01:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid or missing signedXdr in request body.' })
  @ApiResponse({ status: 404, description: 'Deposit intent not found.' })
  @ApiResponse({ status: 409, description: 'Deposit intent is not in the expected XDR_GENERATED state.' })
  submitSignedXdr(@Param('id') id: string, @Body() dto: SubmitSignedXdrDto) {
    return this.depositsService.submitSignedXdr(id, dto);
  }

  /**
   * GET /deposits/:id
   * Get current status and details of a deposit intent.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get deposit details' })
  @ApiParam({ name: 'id', description: 'Deposit intent ID (cuid)', example: 'cmp7deposit001' })
  @ApiResponse({
    status: 200,
    description: 'Deposit intent details returned successfully.',
    schema: {
      example: {
        id: 'cmp7deposit001',
        idempotencyKey: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
        userId: 'nuw8uz50x4swu6b476uf4lla',
        walletAccountId: 'cmp63d000jivmcajyxlkpy',
        vaultId: 'cmp6vault001',
        amount: '100.50',
        assetSymbol: 'USDC',
        status: 'XDR_GENERATED',
        unsignedXdr: 'AAAAAgAAAAB...',
        createdAt: '2026-05-15T12:00:00.000Z',
        updatedAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Deposit intent not found.' })
  getDeposit(@Param('id') id: string) {
    return this.depositsService.getDeposit(id);
  }

  /**
   * GET /deposits?userId=...
   * List all deposit intents for a user.
   */
  @Get()
  @ApiOperation({ summary: 'List user deposits' })
  @ApiQuery({ name: 'userId', description: 'ID of the user whose deposits to list', example: 'nuw8uz50x4swu6b476uf4lla' })
  @ApiResponse({
    status: 200,
    description: 'List of deposit intents for the user.',
    schema: {
      example: [
        {
          id: 'cmp7deposit001',
          idempotencyKey: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          userId: 'nuw8uz50x4swu6b476uf4lla',
          walletAccountId: 'cmp63d000jivmcajyxlkpy',
          vaultId: 'cmp6vault001',
          amount: '100.50',
          assetSymbol: 'USDC',
          status: 'CONFIRMED',
          unsignedXdr: null,
          createdAt: '2026-05-15T12:00:00.000Z',
          updatedAt: '2026-05-15T12:02:00.000Z',
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Missing or invalid userId query parameter.' })
  listDeposits(@Query() query: ListDepositsQuery) {
    return this.depositsService.listDeposits(query.userId);
  }
}
