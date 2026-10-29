import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { redactRequestUrl } from '../redact-url';

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

    const body =
      typeof message === 'object' && message !== null
        ? (message as Record<string, unknown>)
        : null;
    const safePath = redactRequestUrl(request.url.split('?')[0]);
    const responseCode =
      body && typeof body['code'] === 'string' ? body['code'] : undefined;
    const responseMessage =
      body && 'message' in body ? body['message'] : message;

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${safePath} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (status >= 400) {
      this.logger.warn(
        `${request.method} ${safePath} → ${status}${responseCode ? ` code=${responseCode}` : ''}: ${safeLogMessage(responseMessage)}`,
      );
    }

    // Exceções que carregam um corpo estruturado (ex.: BlindPayUpstreamError)
    // trazem `code` e `fields` além da mensagem. Repassar os dois é o que
    // permite ao app reagir por código em vez de dar match na string.
    //
    // `details` existe pelo mesmo motivo, para payload que o app precisa
    // renderizar e não apenas identificar: o 409 de disclosure pendente manda os
    // riscos a exibir junto do código. Sem este passthrough, qualquer chave fora
    // de `code` e `fields` era silenciosamente descartada aqui.
    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: redactRequestUrl(request.url),
      message: body && 'message' in body ? body['message'] : message,
      ...(body && typeof body['code'] === 'string'
        ? { code: body['code'] }
        : {}),
      ...(body && body['fields'] ? { fields: body['fields'] } : {}),
      ...(body && body['details'] ? { details: body['details'] } : {}),
    });
  }
}

function safeLogMessage(value: unknown): string {
  const message = Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .join('. ')
    : typeof value === 'string'
      ? value
      : 'request rejected';

  return message
    .replace(/[GC][A-Z2-7]{55}/g, '[stellar-id]')
    .replace(/\b(?:cm|cl)[a-z0-9]{12,}\b/gi, '[id]')
    .replace(/[A-Za-z0-9+/=]{100,}/g, '[redacted]')
    .slice(0, 300);
}
