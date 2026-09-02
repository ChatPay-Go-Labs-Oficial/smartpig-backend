import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Regressão de segurança.
 *
 * `DELETE /users/:id` apagava qualquer conta cujo id fosse informado no path, sem
 * conferir se o portador do token era o dono — e sem cascade nas FKs, então nem
 * funcionava para conta com histórico. Foi removido; o fluxo de exclusão de conta
 * o substitui, derivando o usuário do token.
 *
 * Estes testes existem para que a rota não volte por descuido.
 */
describe('UsersController', () => {
  let app: INestApplication<App>;

  const usersService = {
    getUser: jest.fn().mockResolvedValue({ id: 'user-a' }),
    updateUser: jest.fn().mockResolvedValue({ id: 'user-a' }),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  it('não expõe DELETE /users/:id — antes da remoção esta rota respondia 200', async () => {
    await request(app.getHttpServer()).delete('/users/user-b').expect(404);
  });

  it('mantém GET /users/:id', async () => {
    await request(app.getHttpServer()).get('/users/user-a').expect(200);
    expect(usersService.getUser).toHaveBeenCalledWith('user-a');
  });

  it('mantém PATCH /users/:id', async () => {
    await request(app.getHttpServer())
      .patch('/users/user-a')
      .send({ name: 'João' })
      .expect(200);
    expect(usersService.updateUser).toHaveBeenCalledWith('user-a', {
      name: 'João',
    });
  });
});
