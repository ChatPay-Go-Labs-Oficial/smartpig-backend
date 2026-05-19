import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { WalletChallengeDto } from './dto/wallet-challenge.dto';
import { WalletLoginDto } from './dto/wallet-login.dto';
import { RefreshDto } from './dto/refresh.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/wallet/challenge
   * Returns a nonce and message for the client to sign.
   * Accepts either stellarAddress (G...) or smartAccountAddress (C...).
   */
  @Post('wallet/challenge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a challenge nonce',
    description:
      'Generates a nonce and returns a message to be signed. ' +
      'Send the signerPublicKey (G... address of the key that will sign). ' +
      'For regular wallets, this is the wallet address. ' +
      'For smart accounts, this is the registered signer key.',
  })
  @ApiResponse({
    status: 200,
    description: 'Challenge generated',
    schema: {
      example: {
        nonce: 'a1b2c3d4e5f6...',
        message: 'SmartPig login: a1b2c3d4e5f6...',
      },
    },
  })
  requestChallenge(@Body() dto: WalletChallengeDto) {
    const address = dto.stellarAddress ?? dto.signerPublicKey;
    return this.authService.generateChallenge(address);
  }

  /**
   * POST /auth/wallet/login
   * Verifies the Ed25519 signature against the challenge, then issues JWT.
   * For smart accounts: send signerPublicKey + smartAccountAddress + signature.
   * For regular wallets: send signerPublicKey (the wallet itself) + signature.
   */
  @Post('wallet/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Wallet login with Ed25519 signature',
    description:
      'Verifies the Ed25519 signature of the challenge message and issues JWT tokens. ' +
      'For regular wallets: signerPublicKey is the wallet address (G...). ' +
      'For smart accounts (OpenZeppelin): signerPublicKey is the registered signer key (G...), and smartAccountAddress is the contract (C...).',
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    schema: {
      example: {
        accessToken: 'eyJhbGciOi...',
        refreshToken: 'a1b2c3d4e5f6...',
        user: { id: 'nuw8uz50x4swu6b476uf4lla', name: null, email: null },
        wallet: {
          id: 'cmp63d000jivmcajyxlkpy',
          stellarAddress:
            'GBBIVZN5N7EMYMQHZL4ME64GWDM5REJDLFBDET7KLIIA6GQRQVJ2IQWE',
          smartAccountAddress:
            'CBH6XACZFDCJUHX2G4ZDNXG5R52JRABJHWLYQOXFYKH6VFYRPAOZ5H7T',
          label: null,
          isActive: true,
        },
        isNewUser: true,
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid signature or expired challenge',
  })
  walletLogin(@Body() dto: WalletLoginDto) {
    return this.authService.walletLogin(dto);
  }

  /**
   * POST /auth/refresh
   * Rotates the refresh token and issues a new access token.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Uses a valid refresh token to obtain a new access token. The old refresh token is revoked.',
  })
  @ApiResponse({
    status: 200,
    description: 'Tokens refreshed',
    schema: {
      example: {
        accessToken: 'eyJhbGciOi...',
        refreshToken: 'new-refresh-token...',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid, expired, or revoked refresh token',
  })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  /**
   * POST /auth/logout
   * Revokes the refresh token.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Logout',
    description: 'Revokes the refresh token, invalidating the session.',
  })
  @ApiResponse({
    status: 200,
    description: 'Logged out',
    schema: { example: { revoked: true } },
  })
  logout(@Body() dto: RefreshDto) {
    return this.authService.logout(dto.refreshToken);
  }

  // ─── Deprecated ──────────────────────────────────────────────────────────

  /**
   * @deprecated Use POST /auth/wallet/challenge + POST /auth/wallet/login instead.
   */
  @Post('wallet')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[DEPRECATED] Wallet login without signature verification',
    deprecated: true,
  })
  @ApiResponse({
    status: 200,
    description: 'User found or created (no JWT tokens)',
  })
  walletLoginLegacy(@Body() dto: WalletChallengeDto) {
    const address = dto.stellarAddress ?? dto.signerPublicKey;
    return this.authService.walletLoginLegacy(address);
  }
}
