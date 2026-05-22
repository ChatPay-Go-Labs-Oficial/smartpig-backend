import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';

@ApiTags('Auth Example')
@Controller('auth-example')
export class AuthExampleController {
  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Public endpoint — no auth required' })
  getPublic() {
    return { message: 'This route is public. No token needed.' };
  }

  @Get('protected')
  @ApiOperation({ summary: 'Protected endpoint — valid Privy token required' })
  getProtected(@CurrentUser() user: { id: string }) {
    return {
      message: 'You are authenticated via Privy',
      userId: user.id,
    };
  }

  @Post('me')
  @ApiOperation({ summary: 'Return the authenticated user identity' })
  getMe(@CurrentUser() user: { id: string }) {
    return {
      userId: user.id,
    };
  }
}
