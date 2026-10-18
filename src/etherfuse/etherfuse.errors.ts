import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import axios from 'axios';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function serializeErrorValue(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || value === undefined) return fallback;

  try {
    return JSON.stringify(value) ?? fallback;
  } catch {
    return fallback;
  }
}

function getApiMessage(data: unknown): string {
  if (!isRecord(data)) return serializeErrorValue(data, 'Unknown error');

  const direct = data['message'] ?? data['error'];
  if (direct !== undefined && direct !== null) {
    return serializeErrorValue(direct, 'Unknown error');
  }

  const errors = data['errors'];
  if (Array.isArray(errors)) {
    return errors
      .map((item) => serializeErrorValue(item, 'Unknown error'))
      .join(', ');
  }

  return serializeErrorValue(data, 'Unknown error');
}

export class EtherfuseUpstreamError extends HttpException {
  constructor(statusCode: number, message: string) {
    super(
      `Etherfuse upstream error (${statusCode}): ${message}`,
      HttpStatus.BAD_GATEWAY,
    );
  }
}

export function mapEtherfuseError(error: unknown): never {
  const logger = new Logger('EtherfuseErrors');

  if (axios.isAxiosError<unknown>(error) && error.response?.data) {
    const data = error.response.data;
    const status = error.response.status ?? 502;
    const message = getApiMessage(data);
    logger.error(`Etherfuse API error ${status}: ${JSON.stringify(data)}`);
    throw new EtherfuseUpstreamError(status, message);
  }

  if (isRecord(error)) {
    const plain = error;
    if (typeof plain['statusCode'] === 'number') {
      const message = serializeErrorValue(
        plain['message'] ?? plain['error'],
        'Unknown error',
      );
      logger.error(`Etherfuse error ${plain['statusCode']}: ${message}`);
      throw new EtherfuseUpstreamError(plain['statusCode'], message);
    }
  }

  if (error instanceof Error) {
    logger.error(`Etherfuse unexpected error: ${error.message}`);
    throw new HttpException(
      `Etherfuse error: ${error.message}`,
      HttpStatus.BAD_GATEWAY,
    );
  }

  logger.error(`Etherfuse unknown error: ${JSON.stringify(error)}`);
  throw new HttpException('Unknown Etherfuse error', HttpStatus.BAD_GATEWAY);
}
