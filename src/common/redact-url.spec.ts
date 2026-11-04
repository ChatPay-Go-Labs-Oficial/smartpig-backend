import { redactRequestUrl } from './redact-url';

const RAW = 'ExponentPushToken[abcdefghijklmnopqrstuv]';

describe('redactRequestUrl', () => {
  it('mascara o token no path codificado (como o app manda)', () => {
    const out = redactRequestUrl(
      `/notifications/devices/${encodeURIComponent(RAW)}`,
    );
    expect(out).toBe('/notifications/devices/[token]');
  });

  it('mascara o token no path sem codificação', () => {
    expect(redactRequestUrl(`/notifications/devices/${RAW}`)).toBe(
      '/notifications/devices/[token]',
    );
  });

  it('preserva a query e o resto da URL', () => {
    expect(redactRequestUrl(`/notifications/devices/${RAW}?x=1`)).toBe(
      '/notifications/devices/[token]?x=1',
    );
  });

  it('mascara um token Expo cru em qualquer outro lugar da URL', () => {
    expect(redactRequestUrl(`/outra/${RAW}`)).not.toContain('efghijkl');
  });

  it('não mexe em rotas sem token', () => {
    expect(redactRequestUrl('/notifications/devices')).toBe(
      '/notifications/devices',
    );
    expect(redactRequestUrl('/deposits?userId=1')).toBe('/deposits?userId=1');
  });
});
