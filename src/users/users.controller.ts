import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccountOwnerService } from '../auth/privy/account-owner.service';
import { CurrentUser } from '../auth/privy/current-user.decorator';
import { PrivyAuthService } from '../auth/privy/privy-auth.service';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateExperienceModeDto } from './dto/update-experience-mode.dto';

/**
 * A conta vem do token, nunca da requisição.
 *
 * O `:id` da rota é comparado com o dono resolvido a partir do token e nunca
 * usado como resposta: um token válido diz quem chamou, não de quem é o perfil
 * pedido. A rota mantém o `:id` porque o app já envia o próprio.
 */
@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountOwner: AccountOwnerService,
    private readonly privyAuthService: PrivyAuthService,
  ) {}

  /**
   * Static route intentionally precedes `:id`, so Express never interprets
   * "me" as a local user id. The local account is derived from the bearer.
   */
  @Patch('me/experience-mode')
  @ApiOperation({ summary: 'Select the Lite or Pro product experience' })
  @ApiResponse({
    status: 200,
    description: 'Effective experience mode (idempotent).',
    schema: { example: { experienceMode: 'LITE' } },
  })
  async updateExperienceMode(
    @Body() dto: UpdateExperienceModeDto,
    @CurrentUser() user: { id: string },
  ) {
    const userId = await this.assertOwner(user.id);
    return this.usersService.updateExperienceMode(userId, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  async getMe(@CurrentUser() user: { id: string }) {
    return this.usersService.getUser(await this.assertOwner(user.id));
  }

  /**
   * GET /users/:id
   * Returns the user profile.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get user profile' })
  @ApiParam({
    name: 'id',
    description: 'User ID (cuid)',
    example: 'nuw8uz50x4swu6b476uf4lla',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile returned successfully.',
    schema: {
      example: {
        id: 'nuw8uz50x4swu6b476uf4lla',
        name: 'João Silva',
        email: 'joao@example.com',
        avatarUrl: null,
        isOnboarded: false,
        createdAt: '2026-05-15T12:00:00.000Z',
        updatedAt: '2026-05-15T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Profile belongs to another user.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async getUser(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    const userId = await this.assertOwner(user.id, id);
    return this.usersService.getUser(userId);
  }

  /**
   * PATCH /users/:id
   * Update user profile (name, email, avatarUrl).
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update user profile' })
  @ApiParam({
    name: 'id',
    description: 'User ID (cuid)',
    example: 'nuw8uz50x4swu6b476uf4lla',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile updated successfully.',
    schema: {
      example: {
        id: 'nuw8uz50x4swu6b476uf4lla',
        name: 'João Silva',
        email: 'joao@example.com',
        avatarUrl: null,
        isOnboarded: true,
        createdAt: '2026-05-15T12:00:00.000Z',
        updatedAt: '2026-05-15T12:05:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request body.' })
  @ApiResponse({ status: 403, description: 'Profile belongs to another user.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: { id: string },
  ) {
    const userId = await this.assertOwner(user.id, id);
    return this.usersService.updateUser(userId, dto);
  }

  private async assertOwner(
    privyUserId: string,
    claimedUserId?: string,
  ): Promise<string> {
    const verifiedStellarAddresses =
      await this.privyAuthService.getStellarWalletAddresses(privyUserId);
    return this.accountOwner.assertOwnership(
      verifiedStellarAddresses,
      claimedUserId,
    );
  }
}
