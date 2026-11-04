/**
 * Mascaramento de tokens de push em texto que vai para log ou resposta.
 *
 * O token Expo identifica o aparelho e permite mandar push para ele; nunca deve
 * aparecer inteiro em log, coluna de erro ou corpo de resposta.
 */

/**
 * Mascara tokens Expo crus num texto. As mensagens de erro do Expo citam o
 * token inteiro (ex.: DeviceNotRegistered).
 */
export function redactPushTokens(text: string): string {
  return text.replace(
    /(Expo(?:nent)?PushToken\[)([^\]]*)\]/g,
    (_m, prefix: string, secret: string) => `${prefix}${secret.slice(0, 4)}…]`,
  );
}

/**
 * URL da requisição segura para log e para o `path` das respostas de erro.
 *
 * `DELETE /notifications/devices/:token` leva o token no path, codificado pelo
 * app com encodeURIComponent (`ExponentPushToken%5B...%5D`), o que escapa do
 * `redactPushTokens`. O segmento inteiro vira `[token]`, com ou sem encoding.
 */
export function redactRequestUrl(url: string): string {
  return redactPushTokens(
    url.replace(/(\/notifications\/devices\/)[^/?#]+/g, '$1[token]'),
  );
}
