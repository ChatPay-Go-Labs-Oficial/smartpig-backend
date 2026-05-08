import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { SubmitSignedXdrDto } from './dto/submit-signed-xdr.dto';
import { IsNotEmpty, IsString } from 'class-validator';

class ListDepositsQuery {
  @IsString()
  @IsNotEmpty()
  userId: string;
}

@Controller('deposits')
export class DepositsController {
  constructor(private readonly depositsService: DepositsService) {}

  /**
   * POST /deposits
   * Create a deposit intent and receive an unsigned XDR to sign on the client.
   */
  @Post()
  createDeposit(@Body() dto: CreateDepositDto) {
    return this.depositsService.createDeposit(dto);
  }

  /**
   * POST /deposits/:id/signed-xdr
   * Submit the signed XDR back to the backend for broadcast to Stellar.
   */
  @Post(':id/signed-xdr')
  submitSignedXdr(@Param('id') id: string, @Body() dto: SubmitSignedXdrDto) {
    return this.depositsService.submitSignedXdr(id, dto);
  }

  /**
   * GET /deposits/:id
   * Get current status and details of a deposit intent.
   */
  @Get(':id')
  getDeposit(@Param('id') id: string) {
    return this.depositsService.getDeposit(id);
  }

  /**
   * GET /deposits?userId=...
   * List all deposit intents for a user.
   */
  @Get()
  listDeposits(@Query() query: ListDepositsQuery) {
    return this.depositsService.listDeposits(query.userId);
  }
}
