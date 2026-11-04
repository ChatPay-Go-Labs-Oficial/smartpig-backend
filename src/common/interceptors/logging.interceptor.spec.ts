import { of, lastValueFrom } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

describe('LoggingInterceptor', () => {
  it('não loga o token Expo do DELETE /notifications/devices/:token', async () => {
    const interceptor = new LoggingInterceptor();
    const log = jest.fn();
    (interceptor as unknown as { logger: { log: jest.Mock } }).logger.log = log;
    const token = encodeURIComponent('ExponentPushToken[abcdefghijklmnop]');
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'DELETE',
          url: `/notifications/devices/${token}`,
        }),
      }),
    };

    await lastValueFrom(
      interceptor.intercept(context as never, { handle: () => of(null) }),
    );

    const line = log.mock.calls[0][0] as string;
    expect(line).toContain('DELETE /notifications/devices/[token]');
    expect(line).not.toContain('abcdefghijklmnop');
  });
});
