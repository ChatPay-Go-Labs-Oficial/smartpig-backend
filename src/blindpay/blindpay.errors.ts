import { HttpException, HttpStatus, Logger } from '@nestjs/common';

export class BlindPayUpstreamError extends HttpException {
  constructor(statusCode: number, message: string) {
    super(
      `BlindPay upstream error (${statusCode}): ${message}`,
      HttpStatus.BAD_GATEWAY,
    );
  }
}

export function mapBlindPayError(error: unknown): never {
  const logger = new Logger('BlindPayErrors');

  if (error && typeof error === 'object') {
    // Axios-style error with response
    const axiosError = error as any;
    if (axiosError.response?.data) {
      const data = axiosError.response.data;
      const status = axiosError.response.status ?? 502;
      // Capture all error details from response
      const message =
        data.message ??
        data.error ??
        (Array.isArray(data.errors) ? data.errors.join(', ') : null) ??
        JSON.stringify(data);
      logger.error(`BlindPay API error ${status}: ${JSON.stringify(data)}`);
      throw new BlindPayUpstreamError(status, message);
    }

    // Plain object error (e.g. { statusCode, message })
    const plain = error as Record<string, unknown>;
    if (typeof plain['statusCode'] === 'number') {
      const message = String(
        plain['message'] ?? plain['error'] ?? 'Unknown error',
      );
      logger.error(`BlindPay error ${plain['statusCode']}: ${message}`);
      throw new BlindPayUpstreamError(plain['statusCode'], message);
    }
  }

  if (error instanceof Error) {
    logger.error(`BlindPay unexpected error: ${error.message}`);
    throw new HttpException(
      `BlindPay error: ${error.message}`,
      HttpStatus.BAD_GATEWAY,
    );
  }

  logger.error(`BlindPay unknown error: ${JSON.stringify(error)}`);
  throw new HttpException('Unknown BlindPay error', HttpStatus.BAD_GATEWAY);
}
