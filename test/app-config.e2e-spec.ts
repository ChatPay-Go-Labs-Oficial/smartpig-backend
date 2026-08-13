import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppConfig (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
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
  });

  it('GET /app-config/version?platform=ios returns 200 without auth', async () => {
    const response = await request(app.getHttpServer())
      .get('/app-config/version')
      .query({ platform: 'ios' })
      .expect(200);

    expect(response.body).toMatchObject({ platform: 'IOS' });
  });

  it('GET /app-config/version without a platform returns both configs', async () => {
    const response = await request(app.getHttpServer())
      .get('/app-config/version')
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /app-config/version?platform=windows returns 400', () => {
    return request(app.getHttpServer())
      .get('/app-config/version')
      .query({ platform: 'windows' })
      .expect(400);
  });

  it('PATCH /app-config/version/ios without x-admin-key returns 401', () => {
    return request(app.getHttpServer())
      .patch('/app-config/version/ios')
      .send({ minVersion: '1.1.0' })
      .expect(401);
  });

  it('PATCH /app-config/version/ios with an invalid body returns 400', () => {
    return request(app.getHttpServer())
      .patch('/app-config/version/ios')
      .set('x-admin-key', process.env.ADMIN_API_KEY ?? '')
      .send({ minVersion: 'not-a-version' })
      .expect(400);
  });

  it('PATCH /app-config/version/ios with a valid admin key updates and persists the value', async () => {
    await request(app.getHttpServer())
      .patch('/app-config/version/ios')
      .set('x-admin-key', process.env.ADMIN_API_KEY ?? '')
      .send({ minVersion: '1.9.9' })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get('/app-config/version')
      .query({ platform: 'ios' })
      .expect(200);

    expect(response.body.minVersion).toBe('1.9.9');

    // restore the seeded value so other test runs stay deterministic
    await request(app.getHttpServer())
      .patch('/app-config/version/ios')
      .set('x-admin-key', process.env.ADMIN_API_KEY ?? '')
      .send({ minVersion: '1.0.0' })
      .expect(200);
  });
});
