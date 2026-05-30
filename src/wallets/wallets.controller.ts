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
import { StellarService } from './stellar.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { TrustlineXdrDto, SubmitTrustlineXdrDto } from './dto/trustline-xdr.dto';

class ListWalletsQuery {
  @ApiProperty({ description: 'ID of the user whose wallets to list' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

@ApiTags('Wallets')
@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly stellarService: StellarService,
  ) {}

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
   * POST /wallets/trustline/xdr
   * Generates an unsigned XDR transaction for adding USDC as a trusted asset
   * on the given Stellar account. The client must sign and submit it.
   */
  @Post('trustline/xdr')
  @ApiOperation({
    summary: 'Generate USDC trustline XDR',
    description:
      'Builds an unsigned Stellar transaction (XDR) with a ChangeTrust operation ' +
      'for USDC (issuer: GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5). ' +
      'The client signs the XDR with the account private key and submits it to the Stellar network.',
  })
  @ApiResponse({
    status: 201,
    description: 'Unsigned XDR generated successfully.',
    schema: {
      example: {
        unsignedXdr: 'AAAAAgAAAAB...',
        asset: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid Stellar address or account not found on network.' })
  async buildUsdcTrustlineXdr(@Body() dto: TrustlineXdrDto) {
    const unsignedXdr = await this.stellarService.buildUsdcTrustlineXdr(dto.stellarAddress);
    return {
      unsignedXdr,
      asset: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    };
  }

  /**
   * POST /wallets/trustline/submit
   * Submits a signed ChangeTrust XDR to the Stellar network.
   */
  @Post('trustline/submit')
  @ApiOperation({
    summary: 'Submit signed USDC trustline XDR',
    description:
      'Submits a signed `ChangeTrust` transaction (XDR) for the USDC asset to the Stellar network.',
  })
  @ApiResponse({
    status: 201,
    description: 'Trustline transaction submitted successfully.',
    schema: { example: { hash: 'abc123...' } },
  })
  @ApiResponse({ status: 400, description: 'Transaction submission failed.' })
  async submitTrustlineXdr(@Body() dto: SubmitTrustlineXdrDto) {
    return this.stellarService.submitSignedXdr(dto.signedXdr);
  }

  /**
   * GET /wallets/:address/balance
   * Fetches Stellar account balances for the given wallet address.
   */
  @Get(':address/balance')
  @ApiOperation({
    summary: 'Get wallet balances from Stellar network',
    description: 'Returns all non-zero asset balances for a Stellar account.',
  })
  @ApiParam({ name: 'address', description: 'Stellar public key (G...)' })
  @ApiResponse({
    status: 200,
    description: 'Wallet balances',
    schema: { example: { balances: [{ asset: 'USDC:issuer...', balance: '1.99' }] } },
  })
  async getWalletBalance(@Param('address') address: string) {
    const balances = await this.stellarService.getWalletBalances(address);
    return { balances };
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
