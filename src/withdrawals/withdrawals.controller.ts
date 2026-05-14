import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
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
  submitSignedXdr(@Param('id') id: string, @Body() dto: SubmitSignedXdrDto) {
    return this.withdrawalsService.submitSignedXdr(id, dto);
  }

  /**
   * GET /withdrawals/:id
   * Get current status and details of a withdrawal intent.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get withdrawal details' })
  getWithdrawal(@Param('id') id: string) {
    return this.withdrawalsService.getWithdrawal(id);
  }

  /**
   * GET /withdrawals?userId=...
   * List all withdrawal intents for a user.
   */
  @Get()
  @ApiOperation({ summary: 'List user withdrawals' })
  listWithdrawals(@Query() query: ListWithdrawalsQuery) {
    return this.withdrawalsService.listWithdrawals(query.userId);
  }
}
