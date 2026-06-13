import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { InvalidAuthTokenError } from '@privy-io/node';
import type { AuthenticatedRequest } from './authenticated-request.interface';
import { IS_ADMIN_KEY } from './admin.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import { PrivyAuthService } from './privy-auth.service';

interface TokenExtraction {
  headers?: { authorization?: string; 'x-admin-key'?: string };
}

@Injectable()
export class PrivyAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly privyAuthService: PrivyAuthService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
      const token = this.extractBearerToken(request);

      if (!token) return true;

      try {
        request.user = await this.privyAuthService.verifyAccessToken(token);
        return true;
      } catch {
        throw new UnauthorizedException(
          'Invalid or expired authentication token',
        );
      }
    }

    const isAdmin = this.reflector.getAllAndOverride<boolean>(IS_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isAdmin) {
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
      const adminKey = this.extractAdminKey(request);

      if (
        adminKey &&
        adminKey === this.configService.get<string>('ADMIN_API_KEY')
      ) {
        request.user = { id: 'admin' };
        return true;
      }
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    try {
      const user = await this.privyAuthService.verifyAccessToken(token);
      request.user = user;
      return true;
    } catch (error) {
      if (error instanceof InvalidAuthTokenError) {
        throw new UnauthorizedException(error.message);
      }
      throw new UnauthorizedException(
        'Invalid or expired authentication token',
      );
    }
  }

  private extractBearerToken(request: TokenExtraction): string | null {
    const header = request.headers?.authorization;
    if (!header) return null;

    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null;

    return token;
  }

  private extractAdminKey(request: TokenExtraction): string | null {
    return request.headers?.['x-admin-key'] ?? null;
  }
}
