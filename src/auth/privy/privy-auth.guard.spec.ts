import { UnauthorizedException } from '@nestjs/common';

// The guard imports InvalidAuthTokenError from @privy-io/node, which pulls in `jose`
// as ESM that Jest cannot parse. The guard only ever uses the class for an
// `instanceof` check, so a stand-in is enough and keeps the global jest transform
// config untouched.
jest.mock('@privy-io/node', () => ({
  InvalidAuthTokenError: class InvalidAuthTokenError extends Error {},
}));

import { PrivyAuthGuard } from './privy-auth.guard';
import { IS_ADMIN_KEY } from './admin.decorator';
import { IS_ADMIN_ONLY_KEY } from './admin-only.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

const ADMIN_API_KEY = 'super-secret-admin-key';
const VALID_TOKEN = 'a-valid-privy-token';

interface Options {
  metadata?: Record<string, boolean>;
  headers?: Record<string, string>;
  adminApiKey?: string | undefined;
  tokenValid?: boolean;
}

function createGuard(options: Options = {}) {
  const {
    metadata = {},
    headers = {},
    adminApiKey = ADMIN_API_KEY,
    tokenValid = true,
  } = options;

  const request: { headers: Record<string, string>; user?: { id: string } } = {
    headers,
  };

  const reflector = {
    getAllAndOverride: jest.fn((key: string) => metadata[key]),
  };

  const privyAuthService = {
    verifyAccessToken: tokenValid
      ? jest.fn().mockResolvedValue({ id: 'did:privy:user-a' })
      : jest.fn().mockRejectedValue(new Error('bad token')),
  };

  const configService = {
    get: jest.fn((key: string) =>
      key === 'ADMIN_API_KEY' ? adminApiKey : undefined,
    ),
  };

  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  };

  const guard = new PrivyAuthGuard(
    reflector as unknown as never,
    privyAuthService as unknown as never,
    configService as unknown as never,
  );

  return {
    guard,
    context: context as unknown as never,
    request,
    privyAuthService,
  };
}

describe('PrivyAuthGuard', () => {
  describe('@AdminOnly() — operator routes', () => {
    it('authorizes a request carrying the correct admin key', async () => {
      const { guard, context, request } = createGuard({
        metadata: { [IS_ADMIN_ONLY_KEY]: true },
        headers: { 'x-admin-key': ADMIN_API_KEY },
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual({ id: 'admin' });
    });

    it('does NOT fall through to bearer auth', async () => {
      // This is the whole reason @AdminOnly exists. Under @Admin() a valid Privy
      // token is accepted, which would let any logged-in user flip a vault live.
      const { guard, context, privyAuthService } = createGuard({
        metadata: { [IS_ADMIN_ONLY_KEY]: true },
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(privyAuthService.verifyAccessToken).not.toHaveBeenCalled();
    });

    it('rejects a wrong admin key', async () => {
      const { guard, context } = createGuard({
        metadata: { [IS_ADMIN_ONLY_KEY]: true },
        headers: { 'x-admin-key': 'wrong' },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('fails closed when ADMIN_API_KEY is not configured', async () => {
      // Without this, an unset key plus an absent header compares undefined to
      // undefined and everything is an admin.
      const { guard, context } = createGuard({
        metadata: { [IS_ADMIN_ONLY_KEY]: true },
        headers: {},
        adminApiKey: undefined,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('fails closed even when the caller sends an empty admin key', async () => {
      const { guard, context } = createGuard({
        metadata: { [IS_ADMIN_ONLY_KEY]: true },
        headers: { 'x-admin-key': '' },
        adminApiKey: undefined,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('@Admin() — unchanged alternative-credential behaviour', () => {
    it('accepts the admin key', async () => {
      const { guard, context, request } = createGuard({
        metadata: { [IS_ADMIN_KEY]: true },
        headers: { 'x-admin-key': ADMIN_API_KEY },
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual({ id: 'admin' });
    });

    it('still falls through to bearer auth without the key', async () => {
      const { guard, context, request } = createGuard({
        metadata: { [IS_ADMIN_KEY]: true },
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual({ id: 'did:privy:user-a' });
    });
  });

  describe('@Public()', () => {
    it('allows an unauthenticated request', async () => {
      const { guard, context } = createGuard({
        metadata: { [IS_PUBLIC_KEY]: true },
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('still rejects an invalid bearer token when one is sent', async () => {
      const { guard, context } = createGuard({
        metadata: { [IS_PUBLIC_KEY]: true },
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        tokenValid: false,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('default — every route is protected', () => {
    it('rejects a request with no token at all', async () => {
      const { guard, context } = createGuard();

      await expect(guard.canActivate(context)).rejects.toThrow(
        'Missing authentication token',
      );
    });

    it('ignores the admin key on a route that did not opt in', async () => {
      const { guard, context } = createGuard({
        headers: { 'x-admin-key': ADMIN_API_KEY },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
