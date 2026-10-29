import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { IS_ADMIN_ONLY_KEY } from '../auth/privy/admin-only.decorator';
import { BroadcastService } from './broadcast.service';
import { NotificationsAdminController } from './notifications.admin.controller';

/**
 * A autenticação de admin vem do guard global (testado em
 * privy-auth.guard.spec.ts). Aqui: a rota está marcada @AdminOnly() e o DTO
 * recusa o que não deve chegar ao push.
 */
describe('NotificationsAdminController', () => {
  let app: INestApplication<App>;
  const broadcast = {
    broadcast: jest.fn().mockResolvedValue({
      broadcastId: 'b1',
      dryRun: false,
      eligible: 3,
      skippedByPreference: 1,
      toNotify: 2,
      created: 2,
    }),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsAdminController],
      providers: [{ provide: BroadcastService, useValue: broadcast }],
    }).compile();
    app = moduleRef.createNestApplication();
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

  it('é @AdminOnly()', () => {
    const reflector = new Reflector();
    expect(reflector.get(IS_ADMIN_ONLY_KEY, NotificationsAdminController)).toBe(
      true,
    );
  });

  it('dispara o broadcast e devolve as contagens', async () => {
    await request(app.getHttpServer())
      .post('/admin/notifications/broadcast')
      .send({
        type: 'APP_UPDATE_AVAILABLE',
        title: 'Nova versão',
        body: 'Atualize o PigFi',
        platform: 'android',
        maxAppVersion: '1.0.12',
        url: '/',
      })
      .expect(200)
      .expect(({ body }) => expect(body.created).toBe(2));
    expect(broadcast.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'APP_UPDATE_AVAILABLE',
        platform: 'android',
        maxAppVersion: '1.0.12',
      }),
    );
  });

  it.each([
    [{ type: 'TRANSFER_RECEIVED' }],
    [{ url: 'https://evil.example' }],
    [{ url: '//evil.example' }],
    [{ title: 'x'.repeat(200) }],
    [{ body: '' }],
    [{ maxAppVersion: 'latest' }],
    [{ platform: 'web' }],
  ])('recusa %j', async (override) => {
    await request(app.getHttpServer())
      .post('/admin/notifications/broadcast')
      .send({
        type: 'ANNOUNCEMENT',
        title: 'Novidade',
        body: 'Texto',
        ...override,
      })
      .expect(400);
    expect(broadcast.broadcast).not.toHaveBeenCalled();
  });
});
