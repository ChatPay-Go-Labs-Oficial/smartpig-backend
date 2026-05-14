import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
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
  submitSignedXdr(@Param('id') id: string, @Body() dto: SubmitSignedXdrDto) {
    return this.depositsService.submitSignedXdr(id, dto);
  }

  /**
   * GET /deposits/:id
   * Get current status and details of a deposit intent.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get deposit details' })
  getDeposit(@Param('id') id: string) {
    return this.depositsService.getDeposit(id);
  }

  /**
   * GET /deposits?userId=...
   * List all deposit intents for a user.
   */
  @Get()
  @ApiOperation({ summary: 'List user deposits' })
  listDeposits(@Query() query: ListDepositsQuery) {
    return this.depositsService.listDeposits(query.userId);
  }
}
