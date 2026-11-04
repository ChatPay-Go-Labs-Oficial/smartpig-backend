import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

// Mesmo stand-in de users.controller.spec.ts: o SDK da Privy puxa `jose` em ESM,
// que o Jest não consegue ler, e nada aqui usa o client real.
jest.mock('@privy-io/node', () => ({
  InvalidAuthTokenError: class InvalidAuthTokenError extends Error {},
  PrivyClient: class PrivyClient {},
}));

import { AccountOwnerService } from '../auth/privy/account-owner.service';
import { PrivyAuthService } from '../auth/privy/privy-auth.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushDevicesService } from './push-devices.service';

const TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const PREFS = {
  transactions: true,
  updates: true,
  marketing: false,
  showDetails: false,
};

/**
 * O dono vem do token: nenhuma rota aceita userId do cliente. O whitelist do
 * ValidationPipe recusa qualquer campo extra, inclusive um `userId` no body.
 */
describe('NotificationsController', () => {
  let app: INestApplication<App>;

  const devices = {
    register: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = {
    getPreferences: jest.fn().mockResolvedValue(PREFS),
    updatePreferences: jest
      .fn()
      .mockResolvedValue({ ...PREFS, marketing: true }),
  };
  const accountOwner = {
    assertOwnership: jest.fn().mockResolvedValue('user-a'),
  };
  const privyAuthService = {
    getStellarWalletAddresses: jest.fn().mockResolvedValue(['GA_USER_A']),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: PushDevicesService, useValue: devices },
        { provide: NotificationsService, useValue: notifications },
        { provide: AccountOwnerService, useValue: accountOwner },
        { provide: PrivyAuthService, useValue: privyAuthService },
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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  describe('POST /notifications/devices', () => {
    it('registra o device para o dono resolvido pelo token e responde 204', async () => {
      await request(app.getHttpServer())
        .post('/notifications/devices')
        .send({ token: TOKEN, platform: 'ios', appVersion: '1.0.12' })
        .expect(204);

      expect(privyAuthService.getStellarWalletAddresses).toHaveBeenCalledWith(
        'privy-did-a',
      );
      expect(devices.register).toHaveBeenCalledWith('user-a', {
        token: TOKEN,
        platform: 'ios',
        appVersion: '1.0.12',
      });
    });

    it('recusa token que não é Expo', async () => {
      await request(app.getHttpServer())
        .post('/notifications/devices')
        .send({ token: 'fcm-token-qualquer', platform: 'android' })
        .expect(400);
      expect(devices.register).not.toHaveBeenCalled();
    });

    it('recusa plataforma desconhecida', async () => {
      await request(app.getHttpServer())
        .post('/notifications/devices')
        .send({ token: TOKEN, platform: 'web' })
        .expect(400);
    });

    it('recusa userId no body', async () => {
      await request(app.getHttpServer())
        .post('/notifications/devices')
        .send({ token: TOKEN, platform: 'ios', userId: 'user-b' })
        .expect(400);
      expect(devices.register).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /notifications/devices/:token', () => {
    it('remove o token decodificado da URL, só do dono, com 204', async () => {
      await request(app.getHttpServer())
        .delete(`/notifications/devices/${encodeURIComponent(TOKEN)}`)
        .expect(204);

      expect(devices.remove).toHaveBeenCalledWith('user-a', TOKEN);
    });
  });

  describe('preferences', () => {
    it('GET devolve as preferências do dono', async () => {
      await request(app.getHttpServer())
        .get('/notifications/preferences')
        .expect(200)
        .expect(({ body }) => expect(body).toEqual(PREFS));
      expect(notifications.getPreferences).toHaveBeenCalledWith('user-a');
    });

    it('PATCH aceita subconjunto e devolve o objeto completo', async () => {
      await request(app.getHttpServer())
        .patch('/notifications/preferences')
        .send({ marketing: true })
        .expect(200)
        .expect(({ body }) =>
          expect(body).toEqual({ ...PREFS, marketing: true }),
        );
      expect(notifications.updatePreferences).toHaveBeenCalledWith('user-a', {
        marketing: true,
      });
    });

    it('PATCH recusa valor que não é booleano e chave desconhecida', async () => {
      await request(app.getHttpServer())
        .patch('/notifications/preferences')
        .send({ marketing: 'sim' })
        .expect(400);
      await request(app.getHttpServer())
        .patch('/notifications/preferences')
        .send({ sms: true })
        .expect(400);
      expect(notifications.updatePreferences).not.toHaveBeenCalled();
    });
  });
});
