const app = {
  useGlobalPipes: jest.fn(),
  useGlobalFilters: jest.fn(),
  useGlobalInterceptors: jest.fn(),
  enableShutdownHooks: jest.fn(),
  listen: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@nestjs/core', () => ({
  NestFactory: { create: jest.fn().mockResolvedValue(app) },
}));
jest.mock('@nestjs/swagger', () => ({
  DocumentBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setVersion: jest.fn().mockReturnThis(),
    addTag: jest.fn().mockReturnThis(),
    build: jest.fn(),
  })),
  SwaggerModule: { createDocument: jest.fn(), setup: jest.fn() },
}));
jest.mock('./app.module', () => ({ AppModule: class {} }));

describe('bootstrap', () => {
  it('enables Nest shutdown hooks so SIGTERM runs onModuleDestroy', async () => {
    require('./main');
    await new Promise((resolve) => setImmediate(resolve));

    expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
  });
});
