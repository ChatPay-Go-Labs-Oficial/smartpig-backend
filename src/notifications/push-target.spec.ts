import {
  compareVersions,
  deviceMatchesTarget,
  readPushData,
} from './push-target';

describe('compareVersions', () => {
  it.each([
    ['1.0.11', '1.0.12', -1],
    ['1.0.12', '1.0.12', 0],
    ['1.10.0', '1.9.9', 1],
    ['2.0.0', '10.0.0', -1],
    ['1.0.12-beta.1', '1.0.12', -1],
    ['1.0.12-beta.2', '1.0.12-beta.10', -1],
    ['1.0.12-alpha', '1.0.12-beta', -1],
    ['1.0.12+build5', '1.0.12', 0],
    ['1.2', '1.2.0', 0],
  ])('%s vs %s = %d', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it('devolve null para versão inválida', () => {
    expect(compareVersions('abc', '1.0.0')).toBeNull();
    expect(compareVersions('1.0.0', '')).toBeNull();
  });
});

describe('deviceMatchesTarget', () => {
  const ios = { platform: 'IOS' as const, appVersion: '1.0.11' };

  it('sem alvo, qualquer device serve', () => {
    expect(deviceMatchesTarget(ios, null)).toBe(true);
  });

  it('filtra por plataforma', () => {
    expect(deviceMatchesTarget(ios, { platform: 'android' })).toBe(false);
    expect(deviceMatchesTarget(ios, { platform: 'ios' })).toBe(true);
  });

  it('maxAppVersion pega só versão estritamente menor', () => {
    expect(deviceMatchesTarget(ios, { maxAppVersion: '1.0.12' })).toBe(true);
    expect(deviceMatchesTarget(ios, { maxAppVersion: '1.0.11' })).toBe(false);
  });

  it('versão desconhecida não entra num filtro por versão', () => {
    expect(
      deviceMatchesTarget(
        { platform: 'IOS', appVersion: null },
        { maxAppVersion: '9.9.9' },
      ),
    ).toBe(false);
  });
});

describe('readPushData', () => {
  it('lê url e alvo gravados pelo broadcast', () => {
    expect(
      readPushData({
        broadcastId: 'b1',
        url: '/vaults',
        target: { platform: 'ios', maxAppVersion: '1.0.12' },
      }),
    ).toEqual({
      url: '/vaults',
      target: { platform: 'ios', maxAppVersion: '1.0.12' },
    });
  });

  it('ignora url que não começa com / e dados malformados', () => {
    expect(readPushData({ url: 'https://evil.example' })).toEqual({
      url: null,
      target: null,
    });
    expect(readPushData({ url: '//evil.example' }).url).toBeNull();
    expect(readPushData(null)).toEqual({ url: null, target: null });
    expect(readPushData({ target: { platform: 'web' } }).target).toEqual({});
  });
});
