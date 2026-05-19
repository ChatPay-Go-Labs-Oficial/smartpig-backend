import { HttpException, HttpStatus, Logger } from '@nestjs/common';

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

  if (error && typeof error === 'object') {
    const axiosError = error as any;
    if (axiosError.response?.data) {
      const data = axiosError.response.data;
      const status = axiosError.response.status ?? 502;
      const message =
        data.message ??
        data.error ??
        (Array.isArray(data.errors) ? data.errors.join(', ') : null) ??
        JSON.stringify(data);
      logger.error(`Etherfuse API error ${status}: ${JSON.stringify(data)}`);
      throw new EtherfuseUpstreamError(status, message);
    }

    const plain = error as Record<string, unknown>;
    if (typeof plain['statusCode'] === 'number') {
      const message = String(
        plain['message'] ?? plain['error'] ?? 'Unknown error',
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
