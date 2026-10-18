import { HttpStatus } from '@nestjs/common';
import { EtherfuseUpstreamError, mapEtherfuseError } from './etherfuse.errors';

describe('mapEtherfuseError', () => {
  it('preserves the upstream status and message from an Axios error', () => {
    expect(() =>
      mapEtherfuseError({
        isAxiosError: true,
        response: {
          status: 429,
          data: { message: 'rate limited' },
        },
      }),
    ).toThrow(
      expect.objectContaining({
        status: HttpStatus.BAD_GATEWAY,
        response: 'Etherfuse upstream error (429): rate limited',
      }) as EtherfuseUpstreamError,
    );
  });

  it('serializes structured API messages without producing object coercion', () => {
    expect(() =>
      mapEtherfuseError({
        isAxiosError: true,
        response: {
          status: 400,
          data: { message: { field: 'invalid' } },
        },
      }),
    ).toThrow('Etherfuse upstream error (400): {"field":"invalid"}');
  });
});
