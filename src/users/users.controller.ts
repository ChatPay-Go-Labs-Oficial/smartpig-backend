import { Body, Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
  @ApiResponse({ status: 404, description: 'User not found.' })
  getUser(@Param('id') id: string) {
    return this.usersService.getUser(id);
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
  @ApiResponse({ status: 404, description: 'User not found.' })
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.updateUser(id, dto);
  }

  /**
   * DELETE /users/:id
   * Permanently delete a user account and all associated data (cascade).
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Delete user account' })
  @ApiParam({
    name: 'id',
    description: 'User ID (cuid)',
    example: 'nuw8uz50x4swu6b476uf4lla',
  })
  @ApiResponse({
    status: 200,
    description: 'User account deleted successfully.',
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  deleteUser(@Param('id') id: string) {
    return this.usersService.deleteUser(id);
  }
}
