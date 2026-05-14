import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { WalletsService } from './wallets.service';
import { CreateWalletDto } from './dto/create-wallet.dto';

class ListWalletsQuery {
  @ApiProperty({ description: 'ID of the user whose wallets to list' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

@ApiTags('Wallets')
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  /**
   * GET /wallets?userId=...
   * List all active wallets for a user.
   */
  @Get()
  @ApiOperation({ summary: 'List wallets for a user' })
  listWallets(@Query() query: ListWalletsQuery) {
    return this.walletsService.listWallets(query.userId);
  }

  /**
   * POST /wallets
   * Add a new Stellar wallet to a user account.
   */
  @Post()
  @ApiOperation({ summary: 'Add a wallet to a user' })
  createWallet(@Body() dto: CreateWalletDto) {
    return this.walletsService.createWallet(dto);
  }

  /**
   * GET /wallets/:id
   * Get a single wallet by ID.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get wallet details' })
  getWallet(@Param('id') id: string) {
    return this.walletsService.getWallet(id);
  }

  /**
   * DELETE /wallets/:id
   * Deactivate a wallet (soft delete).
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate a wallet' })
  removeWallet(@Param('id') id: string) {
    return this.walletsService.removeWallet(id);
  }
}
