import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AxiosError } from 'axios';

export class DefindexException extends HttpException {
  constructor(
    message: string,
    status: number,
    public readonly originalError?: unknown,
  ) {
    super(message, status);
  }
}

function isAxiosError(err: unknown): err is AxiosError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as AxiosError).isAxiosError === true
  );
}

export function mapDefindexError(error: unknown): never {
  const logger = new Logger('DefindexErrorMapper');

  // The SDK's HttpClient interceptor rejects with `error.response.data` (a plain
  // API error object) instead of the original AxiosError. Handle that first.
  if (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof (error as Record<string, unknown>).statusCode === 'number'
  ) {
    const apiErr = error as {
      statusCode: number;
      message?: string;
      error?: string;
    };
    const msg = apiErr.message ?? apiErr.error ?? 'Unknown DeFindex API error';

    logger.warn(`DeFindex API error (${apiErr.statusCode}): ${msg}`);

    switch (apiErr.statusCode) {
      case 401:
      case 403:
        throw new BadGatewayException(
          'DeFindex authentication failed. Check DEFINDEX_API_KEY.',
        );
      case 404:
        throw new NotFoundException(`DeFindex resource not found: ${msg}`);
      case 422:
        throw new UnprocessableEntityException(
          `DeFindex validation error: ${msg}`,
        );
      case 429:
        throw new ServiceUnavailableException(
          'DeFindex rate limit exceeded. Try again shortly.',
        );
      default:
        throw new BadGatewayException(
          `DeFindex upstream error (${apiErr.statusCode}): ${msg}`,
        );
    }
  }

  // DeFindex contract-level error (e.g. Soroban HostError: Storage, MissingValue).
  // The API returns {message, errorCode, error} without a statusCode field.
  if (typeof error === 'object' && error !== null && 'errorCode' in error) {
    const contractErr = error as {
      message?: string;
      errorCode?: number;
      error?: string;
    };
    const msg =
      contractErr.message ?? contractErr.error ?? 'DeFindex contract error';
    logger.warn(
      `DeFindex contract error (code=${contractErr.errorCode ?? 'unknown'}): ${msg}`,
    );
    throw new BadGatewayException(`DeFindex contract error: ${msg}`);
  }

  // Axios HTTP error (raw, not intercepted)
  if (isAxiosError(error)) {
    const axiosErr = error as AxiosError<{ message?: string; error?: string }>;

    if (
      axiosErr.code === 'ECONNABORTED' ||
      axiosErr.code === 'ETIMEDOUT' ||
      axiosErr.message?.includes('timeout')
    ) {
      throw new GatewayTimeoutException('DeFindex request timed out.');
    }

    const status = axiosErr.response?.status;
    const msg =
      axiosErr.response?.data?.message ?? axiosErr.message ?? 'Unknown error';

    switch (status) {
      case 401:
      case 403:
        throw new BadGatewayException(
          'DeFindex authentication failed. Check DEFINDEX_API_KEY.',
        );
      case 404:
        throw new NotFoundException(`DeFindex resource not found: ${msg}`);
      case 422:
        throw new UnprocessableEntityException(
          `DeFindex validation error: ${msg}`,
        );
      case 429:
        throw new ServiceUnavailableException(
          'DeFindex rate limit exceeded. Try again shortly.',
        );
      default:
        throw new BadGatewayException(
          `DeFindex upstream error (${status ?? 'unknown'}): ${msg}`,
        );
    }
  }

  // Generic timeout / connection error
  if (error instanceof Error) {
    if (
      error.message.includes('timeout') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('ECONNREFUSED')
    ) {
      throw new GatewayTimeoutException('DeFindex request timed out.');
    }
    logger.error(`Unexpected DeFindex error: ${error.message}`, error.stack);
    throw new InternalServerErrorException(
      `Unexpected error communicating with DeFindex: ${error.message}`,
    );
  }

  logger.error(
    `Unexpected DeFindex error (non-Error object): ${JSON.stringify(error)}`,
  );
  throw new InternalServerErrorException('Unknown error from DeFindex.');
}
