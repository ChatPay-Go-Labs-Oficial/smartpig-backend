import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { SubmitSignedXdrDto } from './dto/submit-signed-xdr.dto';
import { IsNotEmpty, IsString } from 'class-validator';

class ListWithdrawalsQuery {
  @IsString()
  @IsNotEmpty()
  userId: string;
}

@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  /**
   * POST /withdrawals
   * Create a withdrawal intent and receive an unsigned XDR to sign on the client.
   */
  @Post()
  createWithdrawal(@Body() dto: CreateWithdrawalDto) {
    return this.withdrawalsService.createWithdrawal(dto);
  }

  /**
   * POST /withdrawals/:id/signed-xdr
   * Submit the signed XDR back to the backend for broadcast to Stellar.
   */
  @Post(':id/signed-xdr')
  submitSignedXdr(@Param('id') id: string, @Body() dto: SubmitSignedXdrDto) {
    return this.withdrawalsService.submitSignedXdr(id, dto);
  }

  /**
   * GET /withdrawals/:id
   * Get current status and details of a withdrawal intent.
   */
  @Get(':id')
  getWithdrawal(@Param('id') id: string) {
    return this.withdrawalsService.getWithdrawal(id);
  }

  /**
   * GET /withdrawals?userId=...
   * List all withdrawal intents for a user.
   */
  @Get()
  listWithdrawals(@Query() query: ListWithdrawalsQuery) {
    return this.withdrawalsService.listWithdrawals(query.userId);
  }
}
