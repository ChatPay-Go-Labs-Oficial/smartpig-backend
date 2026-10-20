import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Tripwire da superfície de autorização.
 *
 * Este spec não testa comportamento: ele congela o inventário de quem fica fora
 * do guard global. Adicionar um `@Public()` ou um `@Admin()` novo quebra o
 * teste, o que força a decisão a ser consciente e revisada em vez de passar
 * junto com a feature.
 *
 * `@Public()` dispensa autenticação por completo. `@Admin()` trata a chave de
 * admin como credencial *alternativa* e segue para o bearer auth quando o
 * header não vem, então só serve para leitura; controle de operador usa
 * `@AdminOnly()`, que falha fechado.
 */
const SRC = join(__dirname, '..');

/** Rotas deliberadamente sem autenticação, cada uma com o motivo. */
const EXPECTED_PUBLIC: Record<string, number> = {
  // Raiz e health check: resposta estática, sem dado de usuário.
  'app.controller.ts': 2,
  // O cliente precisa da versão mínima e do registry de assets antes de logar.
  'app-config/app-config.controller.ts': 2,
  // Bootstrap de conta nova. Recuperar conta existente exige token — ver
  // AuthService.walletLogin e auth.service.spec.ts.
  'auth/auth.controller.ts': 1,
  // Webhook da BlindPay: autenticado por HMAC Svix, não por bearer.
  'ramp/ramp.controller.ts': 1,
};

/**
 * Usos restantes de `@Admin()`. Só leitura pode ficar aqui: por causa do
 * fallthrough, `@Admin()` significa na prática "qualquer usuário autenticado".
 */
const EXPECTED_ADMIN_FALLTHROUGH: Record<string, number> = {
  // Classe de VaultsController: as três leituras são para o app. A rota de
  // escrita (`POST /vaults/sync`) sobrepõe com @AdminOnly().
  'vaults/vaults.controller.ts': 1,
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) return [];
    return [full];
  });
}

function countDecorator(decorator: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of sourceFiles(SRC)) {
    // Os próprios arquivos de decorador citam o nome em doc comments.
    if (file.endsWith('.decorator.ts')) continue;

    const matches = readFileSync(file, 'utf8')
      .split('\n')
      // Linha que *usa* o decorador, não que o menciona num comentário.
      .filter((line) => line.trim().startsWith(decorator)).length;

    if (matches > 0) {
      counts[file.slice(SRC.length + 1).replace(/\\/g, '/')] = matches;
    }
  }
  return counts;
}

describe('authorization surface', () => {
  it('only the reviewed routes are @Public()', () => {
    // Um @Public() novo é uma rota alcançável sem token. Se a adição foi
    // proposital, registre o arquivo na lista acima com o motivo.
    expect(countDecorator('@Public()')).toEqual(EXPECTED_PUBLIC);
  });

  it('no write route is gated by @Admin() alone', () => {
    // Controle de operador usa @AdminOnly(), que exige o x-admin-key e falha
    // fechado inclusive quando ADMIN_API_KEY não está configurada.
    expect(countDecorator('@Admin()')).toEqual(EXPECTED_ADMIN_FALLTHROUGH);
  });

  it('every @Admin() file covers its write routes with @AdminOnly()', () => {
    // Cobre o caso de uma rota de escrita herdar o @Admin() da classe sem
    // sobrepor com @AdminOnly().
    const adminFiles = Object.keys(countDecorator('@Admin()'));

    for (const relative of adminFiles) {
      const source = readFileSync(join(SRC, relative), 'utf8');
      const writeDecorators = (
        source.match(/^\s*@(Post|Patch|Put|Delete)\(/gm) ?? []
      ).length;
      const adminOnly = (source.match(/^\s*@AdminOnly\(\)/gm) ?? []).length;

      expect(adminOnly).toBeGreaterThanOrEqual(writeDecorators);
    }
  });
});
