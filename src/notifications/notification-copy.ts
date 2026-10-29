import { NotificationCategory, NotificationType } from '@prisma/client';

/**
 * Textos dos push, centralizados. Tudo em pt-BR.
 *
 * Cada tipo tem uma versão genérica, que é a padrão e não revela nada na tela
 * bloqueada, e opcionalmente uma detalhada, usada só quando o usuário liga
 * `showDetails` e o evento traz todos os dados que o texto pede. Faltando
 * qualquer dado, vale a genérica: um texto pela metade é pior que um genérico.
 */

/** Dados opcionais de um evento, para a versão detalhada do texto. */
export interface NotificationDetails {
  /** Valor em unidades inteiras do ativo (ex.: "50" ou 50.5). */
  amount?: string | number | { toString(): string } | null;
  asset?: string | null;
  /** @username da contraparte (com ou sem @). */
  username?: string | null;
}

export interface NotificationCopy {
  title: string;
  body: string;
}

export const NOTIFICATION_CATEGORY: Record<
  NotificationType,
  NotificationCategory
> = {
  TRANSFER_RECEIVED: NotificationCategory.transactions,
  ONRAMP_COMPLETED: NotificationCategory.transactions,
  ONRAMP_FAILED: NotificationCategory.transactions,
  OFFRAMP_COMPLETED: NotificationCategory.transactions,
  OFFRAMP_FAILED: NotificationCategory.transactions,
  VAULT_DEPOSIT_CONFIRMED: NotificationCategory.transactions,
  VAULT_WITHDRAWAL_CONFIRMED: NotificationCategory.transactions,
  GIFT_CLAIMED: NotificationCategory.transactions,
  GIFT_EXPIRING: NotificationCategory.transactions,
  KYC_APPROVED: NotificationCategory.transactions,
  KYC_REJECTED: NotificationCategory.transactions,
  APP_UPDATE_AVAILABLE: NotificationCategory.updates,
  ANNOUNCEMENT: NotificationCategory.marketing,
};

/** Rota do expo-router que o app abre ao tocar no push. */
export function notificationUrl(category: NotificationCategory): string {
  return category === NotificationCategory.transactions
    ? '/wallet/history'
    : '/';
}

/** Dados já validados e formatados, prontos para o texto. */
interface ResolvedDetails {
  amount: string | null;
  asset: string | null;
  username: string | null;
}

interface CopyEntry {
  generic: NotificationCopy;
  /** Devolve null quando faltam dados: aí vale o genérico. */
  detailed?: (d: ResolvedDetails) => NotificationCopy | null;
}

/** "50,00 USDC", ou null se faltar valor ou ativo. */
function money(d: ResolvedDetails): string | null {
  return d.amount && d.asset ? `${d.amount} ${d.asset}` : null;
}

const COPY: Record<NotificationType, CopyEntry> = {
  TRANSFER_RECEIVED: {
    generic: {
      title: 'Transferência recebida',
      body: 'Você recebeu uma transferência',
    },
    detailed: (d) => {
      const value = money(d);
      if (!value) return null;
      return {
        title: 'Transferência recebida',
        body: d.username
          ? `Você recebeu ${value} de ${d.username}`
          : `Você recebeu ${value}`,
      };
    },
  },
  ONRAMP_COMPLETED: {
    generic: {
      title: 'Depósito concluído',
      body: 'Seu depósito chegou na sua carteira.',
    },
    detailed: (d) => {
      const value = money(d);
      return value
        ? {
            title: 'Depósito concluído',
            body: `${value} chegaram na sua carteira.`,
          }
        : null;
    },
  },
  ONRAMP_FAILED: {
    generic: {
      title: 'Depósito não concluído',
      body: 'Não conseguimos concluir seu depósito. Abra o app para ver os detalhes.',
    },
    detailed: (d) => {
      const value = money(d);
      return value
        ? {
            title: 'Depósito não concluído',
            body: `Não conseguimos concluir seu depósito de ${value}. Abra o app para ver os detalhes.`,
          }
        : null;
    },
  },
  OFFRAMP_COMPLETED: {
    generic: {
      title: 'Saque concluído',
      body: 'Seu saque foi enviado para a sua conta.',
    },
    detailed: (d) => {
      const value = money(d);
      return value
        ? {
            title: 'Saque concluído',
            body: `Seu saque de ${value} foi enviado para a sua conta.`,
          }
        : null;
    },
  },
  OFFRAMP_FAILED: {
    generic: {
      title: 'Saque não concluído',
      body: 'Não conseguimos concluir seu saque. Abra o app para ver os detalhes.',
    },
    detailed: (d) => {
      const value = money(d);
      return value
        ? {
            title: 'Saque não concluído',
            body: `Não conseguimos concluir seu saque de ${value}. Abra o app para ver os detalhes.`,
          }
        : null;
    },
  },
  VAULT_DEPOSIT_CONFIRMED: {
    generic: {
      title: 'Depósito no cofre confirmado',
      body: 'Seu dinheiro já está rendendo no cofre.',
    },
    detailed: (d) => {
      const value = money(d);
      return value
        ? {
            title: 'Depósito no cofre confirmado',
            body: `${value} já estão rendendo no cofre.`,
          }
        : null;
    },
  },
  VAULT_WITHDRAWAL_CONFIRMED: {
    generic: {
      title: 'Resgate confirmado',
      body: 'O valor do resgate já está na sua carteira.',
    },
    detailed: (d) => {
      const value = money(d);
      return value
        ? {
            title: 'Resgate confirmado',
            body: `${value} do resgate já estão na sua carteira.`,
          }
        : null;
    },
  },
  GIFT_CLAIMED: {
    generic: {
      title: 'Presente resgatado',
      body: 'Seu presente foi resgatado.',
    },
    detailed: (d) => {
      const value = money(d);
      return value && d.username
        ? {
            title: 'Presente resgatado',
            body: `${d.username} resgatou seu presente de ${value}`,
          }
        : null;
    },
  },
  GIFT_EXPIRING: {
    generic: {
      title: 'Seu presente vai expirar',
      body: 'Um presente que você enviou ainda não foi resgatado e expira em breve.',
    },
    detailed: (d) => {
      const value = money(d);
      return value
        ? {
            title: 'Seu presente vai expirar',
            body: `Seu presente de ${value} ainda não foi resgatado e expira em breve.`,
          }
        : null;
    },
  },
  KYC_APPROVED: {
    generic: {
      title: 'Cadastro aprovado',
      body: 'Seu cadastro foi aprovado. Você já pode depositar e sacar pelo app.',
    },
  },
  KYC_REJECTED: {
    generic: {
      title: 'Cadastro não aprovado',
      body: 'Não conseguimos aprovar seu cadastro. Abra o app para ver o que fazer.',
    },
  },
  APP_UPDATE_AVAILABLE: {
    generic: {
      title: 'Nova versão do PigFi',
      body: 'Atualize o app para aproveitar as novidades.',
    },
  },
  ANNOUNCEMENT: {
    generic: {
      title: 'Novidade no PigFi',
      body: 'Temos novidades para você. Abra o app para conferir.',
    },
  },
};

const MAX_ASSET_LENGTH = 12;
// Mesmo alfabeto do username do app; qualquer outra coisa não vai para a tela.
const USERNAME_PATTERN = /^[a-z0-9._]{1,30}$/i;
const ASSET_PATTERN = /^[A-Z0-9]+$/i;

/**
 * Valor em pt-BR: "1.234,50". Valores abaixo de 0,01 mantêm as casas
 * necessárias (até 7, a precisão da Stellar). Devolve null para valor ausente,
 * não numérico ou não positivo.
 */
export function formatAmount(
  amount: NotificationDetails['amount'],
): string | null {
  if (amount === null || amount === undefined) return null;
  const value = Number(amount.toString());
  if (!Number.isFinite(value) || value <= 0) return null;

  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 0.01 ? 7 : 2,
  }).format(value);
}

function resolveDetails(details: NotificationDetails): ResolvedDetails {
  const asset =
    details.asset &&
    details.asset.length <= MAX_ASSET_LENGTH &&
    ASSET_PATTERN.test(details.asset)
      ? details.asset.toUpperCase()
      : null;

  const rawUsername = details.username?.replace(/^@/, '') ?? '';
  const username = USERNAME_PATTERN.test(rawUsername)
    ? `@${rawUsername}`
    : null;

  return { amount: formatAmount(details.amount), asset, username };
}

/**
 * Título e texto do push. `details` só deve vir quando o usuário ligou
 * `showDetails`; sem ele, ou com dados insuficientes, devolve o genérico.
 */
export function buildNotificationCopy(
  type: NotificationType,
  details: NotificationDetails | undefined,
): NotificationCopy {
  const entry = COPY[type];
  if (details && entry.detailed) {
    const detailed = entry.detailed(resolveDetails(details));
    if (detailed) return detailed;
  }
  return entry.generic;
}
