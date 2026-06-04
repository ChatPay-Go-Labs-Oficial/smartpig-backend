import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { WalletLoginDto } from './dto/wallet-login.dto';
import { Public } from './privy/public.decorator';

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
  @Public()
  @Post('wallet')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Wallet login / register',
    description:
      'Finds or creates a user identified by their Stellar wallet address. ' +
      'Returns the user profile and the userId to be used in subsequent requests.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Login successful. Returns user profile, wallet info, and whether the account was just created.',
    schema: {
      example: {
        user: {
          id: 'nuw8uz50x4swu6b476uf4lla',
          name: null,
          email: null,
          createdAt: '2026-05-15T12:00:00.000Z',
        },
        wallet: {
          id: 'cmp63d000jivmcajyxlkpy',
          stellarAddress:
            'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
          label: null,
        },
        isNewUser: true,
        needsActivation: true,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid request body (e.g. missing or malformed stellarAddress).',
  })
  walletLogin(@Body() dto: WalletLoginDto) {
    return this.authService.walletLogin(dto);
  }
}
