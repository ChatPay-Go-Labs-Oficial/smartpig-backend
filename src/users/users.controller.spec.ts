import { ForbiddenException, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

// Same stand-in privy-auth.guard.spec.ts uses: the Privy SDK pulls in `jose` as
// ESM that Jest cannot parse, and nothing here exercises the real client.
jest.mock('@privy-io/node', () => ({
  InvalidAuthTokenError: class InvalidAuthTokenError extends Error {},
  PrivyClient: class PrivyClient {},
}));

import { AccountOwnerService } from '../auth/privy/account-owner.service';
import { PrivyAuthService } from '../auth/privy/privy-auth.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * The account comes from the token, never from the path.
 *
 * `DELETE /users/:id` was removed and must not come back; `GET`/`PATCH` compare
 * `:id` against the owner the token resolves to. These tests pin both, so a
 * token for one account cannot reach another's profile.
 */
describe('UsersController', () => {
  let app: INestApplication<App>;

  const usersService = {
    getUser: jest.fn().mockResolvedValue({ id: 'user-a' }),
    updateUser: jest.fn().mockResolvedValue({ id: 'user-a' }),
  };

  // The real service resolves the owner from the wallets Privy verified. Here
  // it only has to answer "user-a owns these addresses" and reject anything
  // else, which is what the controller is responsible for passing through.
  const accountOwner = {
    assertOwnership: jest
      .fn()
      .mockImplementation((_addresses: string[], claimedUserId?: string) => {
        if (claimedUserId && claimedUserId !== 'user-a') {
          throw new ForbiddenException(
            'This account does not belong to the authenticated user',
          );
        }
        return Promise.resolve('user-a');
      }),
  };

  const privyAuthService = {
    getStellarWalletAddresses: jest.fn().mockResolvedValue(['GA_USER_A']),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: AccountOwnerService, useValue: accountOwner },
        { provide: PrivyAuthService, useValue: privyAuthService },
        // Stands in for PrivyAuthGuard, which is registered as APP_GUARD in
        // AuthModule and is what populates request.user in a real request.
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (context: {
              switchToHttp: () => {
                getRequest: () => { user?: { id: string } };
              };
            }) => {
              context.switchToHttp().getRequest().user = { id: 'privy-did-a' };
              return true;
            },
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  it('does not expose DELETE /users/:id', async () => {
    await request(app.getHttpServer()).delete('/users/user-b').expect(404);
  });

  it('still serves GET /users/:id for the owner', async () => {
    await request(app.getHttpServer()).get('/users/user-a').expect(200);
    expect(usersService.getUser).toHaveBeenCalledWith('user-a');
  });

  it('still serves PATCH /users/:id for the owner', async () => {
    await request(app.getHttpServer())
      .patch('/users/user-a')
      .send({ name: 'João' })
      .expect(200);
    expect(usersService.updateUser).toHaveBeenCalledWith('user-a', {
      name: 'João',
    });
  });

  it('refuses GET /users/:id for another account', async () => {
    await request(app.getHttpServer()).get('/users/user-b').expect(403);
    expect(usersService.getUser).not.toHaveBeenCalled();
  });

  it('refuses PATCH /users/:id for another account', async () => {
    await request(app.getHttpServer())
      .patch('/users/user-b')
      .send({ email: 'attacker@example.com' })
      .expect(403);
    expect(usersService.updateUser).not.toHaveBeenCalled();
  });

  it('reads the profile the token resolves to, not the one the path names', async () => {
    await request(app.getHttpServer()).get('/users/user-a').expect(200);
    // The resolved owner is what reaches the service, so a path id cannot widen
    // access even if assertOwnership were to start accepting aliases.
    expect(usersService.getUser).toHaveBeenCalledWith('user-a');
    expect(accountOwner.assertOwnership).toHaveBeenCalledWith(
      ['GA_USER_A'],
      'user-a',
    );
  });
});
