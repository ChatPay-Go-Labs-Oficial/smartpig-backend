import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { CurrentUser } from './current-user.decorator';

@Controller('test')
class TestController {
  @Get()
  test(@CurrentUser() userId: string) {
    return { userId: userId ?? 'no-user' };
  }
}

describe('CurrentUser', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestController],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should return fallback when no authenticated user is present', () => {
    return request(app.getHttpServer())
      .get('/test')
      .expect(200)
      .expect({ userId: 'no-user' });
  });
});
