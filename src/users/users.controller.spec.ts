import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * `DELETE /users/:id` deleted whatever account id the path carried, without
 * checking that the bearer of the token owned it. It was removed; these tests
 * exist so it does not come back unnoticed.
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

  it('does not expose DELETE /users/:id', async () => {
    await request(app.getHttpServer()).delete('/users/user-b').expect(404);
  });

  it('still serves GET /users/:id', async () => {
    await request(app.getHttpServer()).get('/users/user-a').expect(200);
    expect(usersService.getUser).toHaveBeenCalledWith('user-a');
  });

  it('still serves PATCH /users/:id', async () => {
    await request(app.getHttpServer())
      .patch('/users/user-a')
      .send({ name: 'João' })
      .expect(200);
    expect(usersService.updateUser).toHaveBeenCalledWith('user-a', {
      name: 'João',
    });
  });
});
