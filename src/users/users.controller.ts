import { Body, Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
  getUser(@Param('id') id: string) {
    return this.usersService.getUser(id);
  }

  /**
   * PATCH /users/:id
   * Update user profile (name, email, avatarUrl).
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update user profile' })
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.updateUser(id, dto);
  }

  /**
   * DELETE /users/:id
   * Permanently delete a user account and all associated data (cascade).
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Delete user account' })
  deleteUser(@Param('id') id: string) {
    return this.usersService.deleteUser(id);
  }
}
