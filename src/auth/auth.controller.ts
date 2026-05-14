import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { WalletLoginDto } from './dto/wallet-login.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/wallet
   * Register or login using a Stellar wallet address.
   * Returns the user profile and wallet info.
   * isNewUser=true when the account was just created.
   */
  @Post('wallet')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Wallet login / register',
    description:
      'Finds or creates a user identified by their Stellar wallet address. ' +
      'Returns the user profile and the userId to be used in subsequent requests.',
  })
  walletLogin(@Body() dto: WalletLoginDto) {
    return this.authService.walletLogin(dto);
  }
}
