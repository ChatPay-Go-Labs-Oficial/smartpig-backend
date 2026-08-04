import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // Exceções que carregam um corpo estruturado (ex.: BlindPayUpstreamError)
    // trazem `code` e `fields` além da mensagem. Repassar os dois é o que
    // permite ao app reagir por código em vez de dar match na string.
    const body =
      typeof message === 'object' && message !== null
        ? (message as Record<string, unknown>)
        : null;

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: body && 'message' in body ? body['message'] : message,
      ...(body && typeof body['code'] === 'string'
        ? { code: body['code'] }
        : {}),
      ...(body && body['fields'] ? { fields: body['fields'] } : {}),
    });
  }
}
