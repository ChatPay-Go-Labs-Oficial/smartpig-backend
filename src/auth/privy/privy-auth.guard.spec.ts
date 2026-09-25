jest.mock('@privy-io/node', () => ({
  InvalidAuthTokenError: class extends Error {},
}));
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { PrivyAuthGuard } from './privy-auth.guard';
import { PrivyAuthService } from './privy-auth.service';
import { IS_ADMIN_KEY } from './admin.decorator';

function setup(
  admin: boolean,
  headers: Record<string, string> = {},
  key?: string,
) {
  const request = { headers, user: undefined };
  const reflector = {
    getAllAndOverride: jest.fn((name) => name === IS_ADMIN_KEY && admin),
  };
  const auth = {
    verifyAccessToken: jest.fn().mockResolvedValue({ id: 'did:privy:user' }),
  };
  const guard = new PrivyAuthGuard(
    reflector as unknown as Reflector,
    auth as unknown as PrivyAuthService,
    new ConfigService({ ADMIN_API_KEY: key }),
  );
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { guard, context, auth, request };
}

describe('Administrative route authorization', () => {
  it.each([undefined, 'wrong'])(
    'rejects a normal bearer even with admin key %s',
    async (key) => {
      const { guard, context, auth } = setup(
        true,
        {
          authorization: 'Bearer valid-user-token',
          ...(key ? { 'x-admin-key': key } : {}),
        },
        'test-admin-key',
      );
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(auth.verifyAccessToken).not.toHaveBeenCalled();
    },
  );
  it('fails closed when no admin key is configured', async () => {
    const { guard, context } = setup(true, {
      authorization: 'Bearer valid-user-token',
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('accepts the configured admin key', async () => {
    const { guard, context, request } = setup(
      true,
      { 'x-admin-key': 'test-admin-key' },
      'test-admin-key',
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'admin' });
  });
  it('continues accepting a verified bearer for ordinary routes', async () => {
    const { guard, context, request } = setup(false, {
      authorization: 'Bearer user-token',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'did:privy:user' });
  });
  it('does not treat an admin key as a user session', async () => {
    const { guard, context } = setup(
      false,
      { 'x-admin-key': 'test-admin-key' },
      'test-admin-key',
    );
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
