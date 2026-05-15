import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
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
  @ApiQuery({ name: 'userId', description: 'ID of the user whose wallets to list', example: 'nuw8uz50x4swu6b476uf4lla' })
  @ApiResponse({
    status: 200,
    description: 'List of wallets for the user.',
    schema: {
      example: [
        {
          id: 'cmp63d000jivmcajyxlkpy',
          userId: 'nuw8uz50x4swu6b476uf4lla',
          stellarAddress: 'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
          label: 'My main wallet',
          isActive: true,
          createdAt: '2026-05-15T12:00:00.000Z',
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Missing or invalid userId query parameter.' })
  listWallets(@Query() query: ListWalletsQuery) {
    return this.walletsService.listWallets(query.userId);
  }

  /**
   * POST /wallets
   * Add a new Stellar wallet to a user account.
   */
  @Post()
  @ApiOperation({ summary: 'Add a wallet to a user' })
  @ApiResponse({
    status: 201,
    description: 'Wallet created successfully.',
    schema: {
      example: {
        id: 'cmp63d000jivmcajyxlkpy',
        userId: 'nuw8uz50x4swu6b476uf4lla',
        stellarAddress: 'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
        label: 'My main wallet',
        isActive: true,
        createdAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request body (e.g. missing stellarAddress or userId).' })
  @ApiResponse({ status: 409, description: 'Wallet with this Stellar address already exists for the user.' })
  createWallet(@Body() dto: CreateWalletDto) {
    return this.walletsService.createWallet(dto);
  }

  /**
   * GET /wallets/:id
   * Get a single wallet by ID.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get wallet details' })
  @ApiParam({ name: 'id', description: 'Wallet ID (cuid)', example: 'cmp63d000jivmcajyxlkpy' })
  @ApiResponse({
    status: 200,
    description: 'Wallet details returned successfully.',
    schema: {
      example: {
        id: 'cmp63d000jivmcajyxlkpy',
        userId: 'nuw8uz50x4swu6b476uf4lla',
        stellarAddress: 'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
        label: 'My main wallet',
        isActive: true,
        createdAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Wallet not found.' })
  getWallet(@Param('id') id: string) {
    return this.walletsService.getWallet(id);
  }

  /**
   * DELETE /wallets/:id
   * Deactivate a wallet (soft delete).
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate a wallet' })
  @ApiParam({ name: 'id', description: 'Wallet ID (cuid)', example: 'cmp63d000jivmcajyxlkpy' })
  @ApiResponse({
    status: 200,
    description: 'Wallet deactivated successfully.',
    schema: {
      example: {
        id: 'cmp63d000jivmcajyxlkpy',
        userId: 'nuw8uz50x4swu6b476uf4lla',
        stellarAddress: 'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
        label: 'My main wallet',
        isActive: false,
        createdAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Wallet not found.' })
  removeWallet(@Param('id') id: string) {
    return this.walletsService.removeWallet(id);
  }
}
