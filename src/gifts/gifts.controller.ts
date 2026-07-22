import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { GiftsService } from './gifts.service';
import { CreateGiftDto } from './dto/create-gift.dto';
import { ClaimGiftDto } from './dto/claim-gift.dto';

class ListGiftsQuery {
  @ApiProperty({ description: 'The ID of the user whose gifts to list' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

@ApiTags('Gifts')
@Controller('gifts')
export class GiftsController {
  constructor(private readonly giftsService: GiftsService) {}

  /**
   * POST /gifts
   * Create a gift intent. The client funds it by signing a Stellar
   * createClaimableBalance with the returned claim agent + memo.
   */
  @Post()
  @ApiOperation({
    summary: 'Create a gift intent',
    description:
      'Creates a gift intent and returns the share code, the claim agent address and the memo the client must attach to the funding claimable-balance transaction.',
  })
  @ApiResponse({
    status: 201,
    description: 'Gift intent created.',
    schema: {
      example: {
        id: 'cmp7gift001',
        code: 'p3XoZ0uKfL9qA2xYw1vRbg',
        senderUserId: 'user_123',
        amount: '50.00',
        assetSymbol: 'USDC',
        status: 'CREATED',
        memo: 'gift:1a2b3c4d5e6f7a8b',
        claimAgentAddress: 'GABC...XYZ',
        expiresAt: '2026-07-28T00:00:00.000Z',
        createdAt: '2026-07-21T12:00:00.000Z',
        updatedAt: '2026-07-21T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid amount (outside configured limits).',
  })
  @ApiResponse({ status: 404, description: 'Wallet not found for user.' })
  @ApiResponse({
    status: 409,
    description: 'Too many pending gifts for this sender.',
  })
  @ApiResponse({ status: 503, description: 'Gift claim agent not configured.' })
  createGift(@Body() dto: CreateGiftDto) {
    return this.giftsService.createGift(dto);
  }

  /**
   * GET /gifts?userId=...
   * List gifts sent and received by a user.
   */
  @Get()
  @ApiOperation({ summary: 'List user gifts (sent and received)' })
  @ApiQuery({
    name: 'userId',
    description: 'ID of the user whose gifts to list',
    example: 'user_123',
  })
  @ApiResponse({
    status: 200,
    description: 'List of gifts with direction sent/received.',
  })
  listGifts(@Query() query: ListGiftsQuery) {
    return this.giftsService.listGifts(query.userId);
  }

  /**
   * GET /gifts/eligibility?userId=...
   * Whether the user may send gifts (founder allowlist while rollout is gated).
   * Declared BEFORE the :code route so "eligibility" is not parsed as a code.
   */
  @Get('eligibility')
  @ApiOperation({ summary: 'Check whether the user can send gifts' })
  @ApiQuery({
    name: 'userId',
    description: 'ID of the user to check',
    example: 'user_123',
  })
  @ApiResponse({
    status: 200,
    description: 'Eligibility flag.',
    schema: { example: { canGift: true } },
  })
  getEligibility(@Query() query: ListGiftsQuery) {
    return this.giftsService.getEligibility(query.userId);
  }

  /**
   * GET /gifts/:code
   * Public gift preview (rate limiting should be enforced at the edge).
   */
  @Get(':code')
  @ApiOperation({
    summary: 'Preview a gift by code',
    description: 'Public preview: amount, sender name and status only.',
  })
  @ApiParam({
    name: 'code',
    description: 'Gift share code',
    example: 'p3XoZ0uKfL9qA2xYw1vRbg',
  })
  @ApiResponse({
    status: 200,
    description: 'Gift preview.',
    schema: {
      example: {
        amount: '50.00',
        assetSymbol: 'USDC',
        status: 'FUNDED',
        expiresAt: '2026-07-28T00:00:00.000Z',
        senderName: 'Maria',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Gift not found.' })
  getGiftByCode(@Param('code') code: string) {
    return this.giftsService.getGiftByCode(code);
  }

  /**
   * POST /gifts/:code/claim
   * Claim a gift for a newly created account.
   */
  @Post(':code/claim')
  @ApiOperation({
    summary: 'Claim a gift',
    description:
      'Claims the gift claimable balance and pays the recipient wallet in one atomic transaction. Only accounts created after the gift qualify.',
  })
  @ApiParam({
    name: 'code',
    description: 'Gift share code',
    example: 'p3XoZ0uKfL9qA2xYw1vRbg',
  })
  @ApiResponse({
    status: 201,
    description: 'Gift claimed and paid out.',
    schema: {
      example: {
        id: 'cmp7gift001',
        status: 'CLAIMED',
        claimTxHash: 'abc123...',
        amount: '50.00',
      },
    },
  })
  @ApiResponse({
    status: 403,
    description:
      'Recipient not eligible (own gift or account older than the gift).',
  })
  @ApiResponse({ status: 404, description: 'Gift, user or wallet not found.' })
  @ApiResponse({
    status: 409,
    description: 'Gift not claimable in its current state.',
  })
  @ApiResponse({ status: 410, description: 'Gift has expired.' })
  @ApiResponse({
    status: 503,
    description: 'On-chain payout failed; safe to retry.',
  })
  claimGift(@Param('code') code: string, @Body() dto: ClaimGiftDto) {
    return this.giftsService.claimGift(code, dto);
  }
}
