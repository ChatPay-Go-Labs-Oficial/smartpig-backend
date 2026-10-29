import type { AppPlatform, Prisma } from '@prisma/client';

/** Filtro de aparelhos de um broadcast, gravado em `Notification.data.target`. */
export interface PushTarget {
  platform?: 'ios' | 'android';
  /** Só aparelhos com appVersion estritamente menor que esta. */
  maxAppVersion?: string;
}

const PLATFORM_ENUM: Record<
  NonNullable<PushTarget['platform']>,
  AppPlatform
> = {
  ios: 'IOS',
  android: 'ANDROID',
};

export function platformEnum(
  platform: NonNullable<PushTarget['platform']>,
): AppPlatform {
  return PLATFORM_ENUM[platform];
}

interface ParsedVersion {
  core: number[];
  prerelease: string[];
}

// x, x.y ou x.y.z, com pré-release e build opcionais (semver).
const VERSION_PATTERN =
  /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(version.trim());
  if (!match) return null;
  return {
    core: [match[1], match[2], match[3]].map((n) => Number(n ?? 0)),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

/**
 * Compara versões pelas regras do semver: núcleo numérico campo a campo (então
 * 1.0.100 > 1.0.12), pré-release vem antes da versão final, e o build (+...)
 * não conta. Devolve -1, 0 ou 1, ou null se alguma for inválida.
 */
export function compareVersions(a: string, b: string): number | null {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return null;

  for (let i = 0; i < 3; i++) {
    if (va.core[i] !== vb.core[i]) return va.core[i] < vb.core[i] ? -1 : 1;
  }

  if (va.prerelease.length === 0 || vb.prerelease.length === 0) {
    if (va.prerelease.length === vb.prerelease.length) return 0;
    return va.prerelease.length === 0 ? 1 : -1;
  }

  const length = Math.max(va.prerelease.length, vb.prerelease.length);
  for (let i = 0; i < length; i++) {
    const pa = va.prerelease[i];
    const pb = vb.prerelease[i];
    if (pa === undefined) return -1;
    if (pb === undefined) return 1;
    if (pa === pb) continue;
    const na = /^\d+$/.test(pa);
    const nb = /^\d+$/.test(pb);
    if (na && nb) return Number(pa) < Number(pb) ? -1 : 1;
    if (na !== nb) return na ? -1 : 1;
    return pa < pb ? -1 : 1;
  }
  return 0;
}

/**
 * Se o aparelho está no alvo. Versão ausente ou inválida não entra num filtro
 * por versão: não dá para afirmar que ela é menor.
 */
export function deviceMatchesTarget(
  device: { platform: AppPlatform; appVersion: string | null },
  target: PushTarget | null,
): boolean {
  if (!target) return true;
  if (target.platform && device.platform !== PLATFORM_ENUM[target.platform]) {
    return false;
  }
  if (target.maxAppVersion) {
    if (!device.appVersion) return false;
    const cmp = compareVersions(device.appVersion, target.maxAppVersion);
    if (cmp === null || cmp >= 0) return false;
  }
  return true;
}

/** Rota interna do expo-router: começa com uma única "/". */
export function isInternalUrl(url: unknown): url is string {
  return typeof url === 'string' && /^\/(?!\/)/.test(url);
}

/** Lê `url` e `target` de `Notification.data`, ignorando o que não é válido. */
export function readPushData(data: Prisma.JsonValue | null | undefined): {
  url: string | null;
  target: PushTarget | null;
} {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { url: null, target: null };
  }
  const record = data as Record<string, unknown>;
  const url = isInternalUrl(record.url) ? record.url : null;

  const rawTarget = record.target;
  if (!rawTarget || typeof rawTarget !== 'object' || Array.isArray(rawTarget)) {
    return { url, target: null };
  }
  const t = rawTarget as Record<string, unknown>;
  const target: PushTarget = {};
  if (t.platform === 'ios' || t.platform === 'android') {
    target.platform = t.platform;
  }
  if (typeof t.maxAppVersion === 'string' && t.maxAppVersion) {
    target.maxAppVersion = t.maxAppVersion;
  }
  return { url, target };
}
