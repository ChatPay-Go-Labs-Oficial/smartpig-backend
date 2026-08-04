import { HttpException, HttpStatus, Logger } from '@nestjs/common';

/**
 * Código estável para o app parear sem string-matching na mensagem.
 * A mensagem em si vem da BlindPay e pode mudar sem aviso; o código, não.
 */
export type BlindPayErrorCode =
  | 'BLINDPAY_VALIDATION'
  | 'BLINDPAY_NOT_FOUND'
  | 'BLINDPAY_CONFLICT'
  | 'BLINDPAY_UNAUTHORIZED'
  | 'BLINDPAY_RATE_LIMITED'
  | 'BLINDPAY_UNAVAILABLE';

export interface BlindPayErrorBody {
  statusCode: number;
  code: BlindPayErrorCode;
  message: string;
  /** Erros por campo, quando a BlindPay devolve `errors[]` estruturado. */
  fields?: Record<string, string>;
}

export class BlindPayUpstreamError extends HttpException {
  constructor(body: BlindPayErrorBody) {
    super(body, body.statusCode);
  }
}

/**
 * Traduz o status da BlindPay para o que devolvemos ao app.
 *
 * Erros de cliente (4xx) são repassados com o mesmo status: um `400 tax_id
 * inválido` chegando como `502 Bad Gateway` faz o app tratar erro de
 * preenchimento como indisponibilidade. 5xx e falha de rede viram 502, que é
 * o que realmente aconteceu — o upstream falhou.
 *
 * 401/403 são exceção: significam credencial nossa inválida, não erro do
 * usuário, então viram 502 em vez de vazar "não autorizado" para o app.
 */
function classify(status: number): {
  httpStatus: number;
  code: BlindPayErrorCode;
} {
  if (status === 401 || status === 403) {
    return {
      httpStatus: HttpStatus.BAD_GATEWAY,
      code: 'BLINDPAY_UNAUTHORIZED',
    };
  }
  if (status === 404) {
    return { httpStatus: HttpStatus.NOT_FOUND, code: 'BLINDPAY_NOT_FOUND' };
  }
  if (status === 409) {
    return { httpStatus: HttpStatus.CONFLICT, code: 'BLINDPAY_CONFLICT' };
  }
  if (status === 429) {
    return {
      httpStatus: HttpStatus.TOO_MANY_REQUESTS,
      code: 'BLINDPAY_RATE_LIMITED',
    };
  }
  if (status >= 400 && status < 500) {
    return { httpStatus: HttpStatus.BAD_REQUEST, code: 'BLINDPAY_VALIDATION' };
  }
  return { httpStatus: HttpStatus.BAD_GATEWAY, code: 'BLINDPAY_UNAVAILABLE' };
}

/**
 * Extrai erros por campo quando a BlindPay devolve `errors[]`.
 *
 * Formatos vistos: `[{ path: 'tax_id', message: '...' }]` (estilo zod) e
 * `['tax_id is invalid']` (strings soltas). O segundo não tem chave de campo,
 * então só entra na mensagem geral.
 */
function extractFields(data: unknown): Record<string, string> | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const errors = (data as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return undefined;

  const fields: Record<string, string> = {};
  for (const entry of errors) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const path = e['path'] ?? e['field'] ?? e['key'];
    const message = e['message'] ?? e['error'];
    const pathKey = Array.isArray(path) ? path.join('.') : path;
    if (typeof pathKey === 'string' && typeof message === 'string') {
      fields[pathKey] = message;
    }
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

function extractMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return typeof data === 'string' && data.trim() ? data : null;
  }
  const d = data as Record<string, unknown>;
  if (typeof d['message'] === 'string') return d['message'];
  if (typeof d['error'] === 'string') return d['error'];
  if (Array.isArray(d['errors'])) {
    const parts = d['errors']
      .map((e) =>
        typeof e === 'string'
          ? e
          : e &&
              typeof e === 'object' &&
              typeof (e as { message?: unknown }).message === 'string'
            ? (e as { message: string }).message
            : null,
      )
      .filter((p): p is string => Boolean(p));
    if (parts.length > 0) return parts.join(', ');
  }
  return null;
}

export function mapBlindPayError(error: unknown): never {
  const logger = new Logger('BlindPayErrors');

  if (error && typeof error === 'object') {
    const axiosError = error as {
      response?: { status?: number; data?: unknown };
    };

    if (axiosError.response) {
      const data = axiosError.response.data;
      const upstreamStatus = axiosError.response.status ?? 502;
      const { httpStatus, code } = classify(upstreamStatus);
      const message = extractMessage(data) ?? 'Erro na BlindPay';
      const fields = extractFields(data);

      // O payload cru só vai para o log — a resposta ao cliente carrega a
      // mensagem já extraída, sem JSON.stringify de objeto desconhecido.
      logger.error(
        `BlindPay API error ${upstreamStatus} → ${httpStatus} ${code}: ${JSON.stringify(data)}`,
      );
      throw new BlindPayUpstreamError({
        statusCode: httpStatus,
        code,
        message,
        fields,
      });
    }

    // Erro em formato de objeto simples (ex.: { statusCode, message })
    const plain = error as Record<string, unknown>;
    if (typeof plain['statusCode'] === 'number') {
      const upstreamStatus = plain['statusCode'];
      const { httpStatus, code } = classify(upstreamStatus);
      const raw = plain['message'] ?? plain['error'];
      const message =
        typeof raw === 'string' && raw.trim() ? raw : 'Erro na BlindPay';
      logger.error(
        `BlindPay error ${upstreamStatus} → ${httpStatus} ${code}: ${message}`,
      );
      throw new BlindPayUpstreamError({
        statusCode: httpStatus,
        code,
        message,
      });
    }
  }

  // Sem `response`: timeout, DNS, conexão recusada. Sempre indisponibilidade.
  if (error instanceof Error) {
    logger.error(`BlindPay unexpected error: ${error.message}`);
    throw new BlindPayUpstreamError({
      statusCode: HttpStatus.BAD_GATEWAY,
      code: 'BLINDPAY_UNAVAILABLE',
      message: error.message,
    });
  }

  logger.error(`BlindPay unknown error: ${JSON.stringify(error)}`);
  throw new BlindPayUpstreamError({
    statusCode: HttpStatus.BAD_GATEWAY,
    code: 'BLINDPAY_UNAVAILABLE',
    message: 'Erro desconhecido na BlindPay',
  });
}
