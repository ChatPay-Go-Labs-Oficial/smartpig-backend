import { redactPushTokens } from './expo-push.client';

describe('redactPushTokens', () => {
  it('mascara tokens Expo em mensagens de erro', () => {
    const msg =
      '"ExponentPushToken[abcdefghijklmnopqrstuv]" is not a registered push notification recipient; ExpoPushToken[zzzz1234]';
    const out = redactPushTokens(msg);
    expect(out).not.toContain('abcdefghijklmnopqrstuv');
    expect(out).toContain('ExponentPushToken[abcd…]');
    expect(out).toContain('ExpoPushToken[zzzz…]');
  });

  it('não mexe em texto sem token', () => {
    expect(redactPushTokens('Internal error')).toBe('Internal error');
  });
});
