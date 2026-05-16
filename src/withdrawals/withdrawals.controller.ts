import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { WithdrawalsService } from './withdrawals.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { SubmitSignedXdrDto } from './dto/submit-signed-xdr.dto';

class ListWithdrawalsQuery {
  @ApiProperty({ description: 'The ID of the user whose withdrawals to list' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

@ApiTags('Withdrawals')
@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  /**
   * POST /withdrawals
   * Create a withdrawal intent and receive an unsigned XDR to sign on the client.
   */
  @Post()
  @ApiOperation({
    summary: 'Create a withdrawal intent',
    description:
      'Creates a withdrawal intent and returns an unsigned Stellar transaction (XDR) that must be signed by the user.',
  })
  @ApiResponse({
    status: 201,
    description: 'Withdrawal intent created. The unsignedXdr must be signed by the user and submitted back.',
    schema: {
      example: {
        id: 'cmp7withdrawal001',
        idempotencyKey: 'd290f1ee-6c54-4b01-90e6-d701748f0852',
        userId: 'nuw8uz50x4swu6b476uf4lla',
        walletAccountId: 'cmp63d000jivmcajyxlkpy',
        vaultId: 'cmp6vault001',
        shareAmount: '50.00000000',
        status: 'XDR_GENERATED',
        unsignedXdr: 'AAAAAgAAAAB...',
        createdAt: '2026-05-15T12:00:00.000Z',
        updatedAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request body (e.g. missing shareAmount, vaultId, or walletAccountId).' })
  @ApiResponse({ status: 404, description: 'Vault or wallet not found.' })
  @ApiResponse({ status: 409, description: 'Duplicate idempotency key — a withdrawal with this key already exists.' })
  createWithdrawal(@Body() dto: CreateWithdrawalDto) {
    return this.withdrawalsService.createWithdrawal(dto);
  }

  /**
   * POST /withdrawals/:id/signed-xdr
   * Submit the signed XDR back to the backend for broadcast to Stellar.
   */
  @Post(':id/signed-xdr')
  @ApiOperation({
    summary: 'Submit signed transaction',
    description:
      'Submits a signed Stellar transaction (XDR) for a specific withdrawal intent to be broadcasted to the network.',
  })
  @ApiParam({ name: 'id', description: 'Withdrawal intent ID (cuid)', example: 'cmp7withdrawal001' })
  @ApiResponse({
    status: 201,
    description: 'Signed XDR accepted and submitted to the Stellar network.',
    schema: {
      example: {
        id: 'cmp7withdrawal001',
        status: 'SUBMITTED',
        updatedAt: '2026-05-15T12:01:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid or missing signedXdr in request body.' })
  @ApiResponse({ status: 404, description: 'Withdrawal intent not found.' })
  @ApiResponse({ status: 409, description: 'Withdrawal intent is not in the expected XDR_GENERATED state.' })
  submitSignedXdr(@Param('id') id: string, @Body() dto: SubmitSignedXdrDto) {
    return this.withdrawalsService.submitSignedXdr(id, dto);
  }

  /**
   * GET /withdrawals/:id
   * Get current status and details of a withdrawal intent.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get withdrawal details' })
  @ApiParam({ name: 'id', description: 'Withdrawal intent ID (cuid)', example: 'cmp7withdrawal001' })
  @ApiResponse({
    status: 200,
    description: 'Withdrawal intent details returned successfully.',
    schema: {
      example: {
        id: 'cmp7withdrawal001',
        idempotencyKey: 'd290f1ee-6c54-4b01-90e6-d701748f0852',
        userId: 'nuw8uz50x4swu6b476uf4lla',
        walletAccountId: 'cmp63d000jivmcajyxlkpy',
        vaultId: 'cmp6vault001',
        shareAmount: '50.00000000',
        status: 'XDR_GENERATED',
        unsignedXdr: 'AAAAAgAAAAB...',
        createdAt: '2026-05-15T12:00:00.000Z',
        updatedAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Withdrawal intent not found.' })
  getWithdrawal(@Param('id') id: string) {
    return this.withdrawalsService.getWithdrawal(id);
  }

  /**
   * GET /withdrawals?userId=...
   * List all withdrawal intents for a user.
   */
  @Get()
  @ApiOperation({ summary: 'List user withdrawals' })
  @ApiQuery({ name: 'userId', description: 'ID of the user whose withdrawals to list', example: 'nuw8uz50x4swu6b476uf4lla' })
  @ApiResponse({
    status: 200,
    description: 'List of withdrawal intents for the user.',
    schema: {
      example: [
        {
          id: 'cmp7withdrawal001',
          idempotencyKey: 'd290f1ee-6c54-4b01-90e6-d701748f0852',
          userId: 'nuw8uz50x4swu6b476uf4lla',
          walletAccountId: 'cmp63d000jivmcajyxlkpy',
          vaultId: 'cmp6vault001',
          shareAmount: '50.00000000',
          status: 'CONFIRMED',
          unsignedXdr: null,
          createdAt: '2026-05-15T12:00:00.000Z',
          updatedAt: '2026-05-15T12:02:00.000Z',
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Missing or invalid userId query parameter.' })
  listWithdrawals(@Query() query: ListWithdrawalsQuery) {
    return this.withdrawalsService.listWithdrawals(query.userId);
  }
}
