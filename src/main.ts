import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';

  // Produção fica em log/warn/error: `debug`/`verbose` incluem corpo de
  // requisição das integrações, que carrega dados pessoais de KYC. O default do
  // Nest imprime todos os níveis.
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: isProduction
      ? ['log', 'warn', 'error']
      : ['log', 'warn', 'error', 'debug', 'verbose'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Fora de produção apenas. Para inspecionar o contrato em produção, gere o
  // JSON no build e sirva-o atrás do admin, nunca em rota aberta.
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('SmartPig API')
      .setDescription(
        'SmartPig Backend API - Documentation for smart savings and investment vaults.',
      )
      .setVersion('1.0')
      .addTag('SmartPig')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Liga os sinais do processo (SIGTERM, SIGINT) ao ciclo de vida do Nest.
  // Sem isso o `onModuleDestroy` do PrismaService nunca roda: no redeploy o
  // processo morre de uma vez, o pool cai sem encerramento limpo (o Postgres
  // registra `unexpected eof while reading`) e as requisições em voo são
  // cortadas no meio — o que num fluxo de ramp pode deixar registro criado na
  // BlindPay sem a linha local correspondente.
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
