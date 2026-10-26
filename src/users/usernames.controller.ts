import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountOwnerService } from '../auth/privy/account-owner.service';
import { CurrentUser } from '../auth/privy/current-user.decorator';
import { PrivyAuthService } from '../auth/privy/privy-auth.service';
import { CreateUsernameDto } from './dto/create-username.dto';
import { UsernamesService } from './usernames.service';

@ApiTags('Usernames')
@Controller()
export class UsernamesController {
  constructor(
    private readonly usernames: UsernamesService,
    private readonly accountOwner: AccountOwnerService,
    private readonly privyAuth: PrivyAuthService,
  ) {}

  @Get('usernames/:username/availability')
  @ApiOperation({ summary: 'Check exact username availability' })
  availability(@Param('username') username: string) {
    return this.usernames.availability(username);
  }

  @Post('users/me/username')
  @ApiOperation({ summary: 'Permanently set the authenticated username' })
  async create(
    @Body() dto: CreateUsernameDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.usernames.create(await this.localUserId(user.id), dto.username);
  }

  @Get('usernames/:username')
  @ApiOperation({ summary: 'Resolve an exact username for a transfer' })
  resolve(@Param('username') username: string) {
    return this.usernames.resolve(username);
  }

  private async localUserId(privyUserId: string): Promise<string> {
    const addresses =
      await this.privyAuth.getStellarWalletAddresses(privyUserId);
    return this.accountOwner.resolveUserId(addresses);
  }
}
