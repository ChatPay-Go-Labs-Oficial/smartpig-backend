import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function run(exception: unknown, url = '/deposits') {
  const json = jest.fn<void, [Record<string, unknown>]>();
  const status = jest
    .fn<{ json: typeof json }, [number]>()
    .mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'POST', url }),
    }),
  };

  new HttpExceptionFilter().catch(exception, host as unknown as never);

  return {
    status: status.mock.calls[0][0],
    body: json.mock.calls[0][0],
  };
}

describe('HttpExceptionFilter', () => {
  it('não devolve nem loga o token Expo do path', () => {
    const token = encodeURIComponent('ExponentPushToken[abcdefghijklmnop]');
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const { body } = run(
      new BadRequestException('bad'),
      `/notifications/devices/${token}`,
    );

    expect(body.path).toBe('/notifications/devices/[token]');
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('abcdefghijklmnop');
    warn.mockRestore();
  });

  it('shapes a plain HttpException', () => {
    const { status, body } = run(new BadRequestException('bad input'));

    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body).toMatchObject({
      statusCode: 400,
      message: 'bad input',
      path: '/deposits',
    });
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it('forwards a structured code so the app reacts on it, not on the string', () => {
    const { body } = run(
      new ConflictException({
        message: 'nope',
        code: 'DISCLOSURE_NOT_ACKNOWLEDGED',
      }),
    );

    expect(body).toMatchObject({
      statusCode: 409,
      message: 'nope',
      code: 'DISCLOSURE_NOT_ACKNOWLEDGED',
    });
  });

  it('forwards `details`, which the disclosure 409 needs to be actionable', () => {
    // Before the passthrough existed, every key other than code/fields was dropped
    // here, so the app received the code with nothing to render.
    const details = {
      vaultId: 'vault-1',
      version: 3,
      risks: [{ code: 'SMART_CONTRACT', severity: 'HIGH' }],
    };

    const { body } = run(
      new ConflictException({
        message: 'Disclosure not acknowledged',
        code: 'DISCLOSURE_NOT_ACKNOWLEDGED',
        details,
      }),
    );

    expect(body.details).toEqual(details);
  });

  it('forwards `fields` for validation payloads', () => {
    const { body } = run(
      new BadRequestException({
        message: 'invalid',
        fields: { amount: 'too small' },
      }),
    );

    expect(body.fields).toEqual({ amount: 'too small' });
  });

  it('omits code, fields and details when absent', () => {
    const { body } = run(new BadRequestException('plain'));

    expect(body).not.toHaveProperty('code');
    expect(body).not.toHaveProperty('fields');
    expect(body).not.toHaveProperty('details');
  });

  it('ignores a non-string code rather than forwarding junk', () => {
    const { body } = run(new ConflictException({ message: 'x', code: 42 }));

    expect(body).not.toHaveProperty('code');
  });

  it('turns an unknown throwable into a 500 without leaking internals', () => {
    const { status, body } = run(new Error('connection string leaked here'));

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.message).toBe('Internal server error');
  });

  it('keeps the status of a non-5xx HttpException subclass', () => {
    const { status } = run(new HttpException('gone', HttpStatus.GONE));

    expect(status).toBe(HttpStatus.GONE);
  });
});
