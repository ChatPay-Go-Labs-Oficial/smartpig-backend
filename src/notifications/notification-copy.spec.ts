import { NotificationCategory, NotificationType } from '@prisma/client';
import {
  NOTIFICATION_CATEGORY,
  buildNotificationCopy,
  formatAmount,
  notificationUrl,
} from './notification-copy';

describe('notification copy', () => {
  it('tem categoria e texto para todos os tipos do enum', () => {
    for (const type of Object.values(NotificationType)) {
      expect(NOTIFICATION_CATEGORY[type]).toBeDefined();
      const copy = buildNotificationCopy(type, undefined);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });

  it('classifica as categorias como no contrato', () => {
    expect(NOTIFICATION_CATEGORY.OFFRAMP_COMPLETED).toBe(
      NotificationCategory.transactions,
    );
    expect(NOTIFICATION_CATEGORY.KYC_APPROVED).toBe(
      NotificationCategory.transactions,
    );
    expect(NOTIFICATION_CATEGORY.APP_UPDATE_AVAILABLE).toBe(
      NotificationCategory.updates,
    );
    expect(NOTIFICATION_CATEGORY.ANNOUNCEMENT).toBe(
      NotificationCategory.marketing,
    );
  });

  it('usa o texto genérico quando não há detalhes', () => {
    const copy = buildNotificationCopy('TRANSFER_RECEIVED', undefined);
    expect(copy.body).toBe('Você recebeu uma transferência');
  });

  it('usa o texto detalhado com valor e @username', () => {
    const copy = buildNotificationCopy('TRANSFER_RECEIVED', {
      amount: '50',
      asset: 'USDC',
      username: 'joao',
    });
    expect(copy.body).toBe('Você recebeu 50,00 USDC de @joao');
  });

  it('não duplica o @ quando o username já vem com ele', () => {
    const copy = buildNotificationCopy('GIFT_CLAIMED', {
      amount: 10,
      asset: 'USDC',
      username: '@maria',
    });
    expect(copy.body).toBe('@maria resgatou seu presente de 10,00 USDC');
  });

  it('cai no genérico quando falta um dado exigido pelo texto detalhado', () => {
    const generic = buildNotificationCopy('GIFT_CLAIMED', undefined);
    expect(
      buildNotificationCopy('GIFT_CLAIMED', { amount: '10', asset: 'USDC' }),
    ).toEqual(generic);
    expect(
      buildNotificationCopy('OFFRAMP_COMPLETED', { asset: 'USDC' }),
    ).toEqual(buildNotificationCopy('OFFRAMP_COMPLETED', undefined));
  });

  it('cai no genérico com valor inválido ou username fora do formato', () => {
    expect(
      buildNotificationCopy('ONRAMP_COMPLETED', {
        amount: 'abc',
        asset: 'USDC',
      }),
    ).toEqual(buildNotificationCopy('ONRAMP_COMPLETED', undefined));
    expect(
      buildNotificationCopy('GIFT_CLAIMED', {
        amount: '1',
        asset: 'USDC',
        username: 'x<script>',
      }),
    ).toEqual(buildNotificationCopy('GIFT_CLAIMED', undefined));
  });

  it('tipos sem versão detalhada ignoram os detalhes', () => {
    expect(
      buildNotificationCopy('KYC_APPROVED', { amount: '1', asset: 'USDC' }),
    ).toEqual(buildNotificationCopy('KYC_APPROVED', undefined));
  });

  it('formata valores em pt-BR', () => {
    expect(formatAmount('1234.5')).toBe('1.234,50');
    expect(formatAmount('0.0000123')).toBe('0,0000123');
    expect(formatAmount('-1')).toBeNull();
    expect(formatAmount(undefined)).toBeNull();
  });

  it('leva os eventos de transação ao histórico', () => {
    expect(notificationUrl(NotificationCategory.transactions)).toBe(
      '/wallet/history',
    );
    expect(notificationUrl(NotificationCategory.updates)).toBe('/');
  });
});
