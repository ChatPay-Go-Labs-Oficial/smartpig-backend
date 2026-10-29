import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Expo,
  type ExpoPushMessage,
  type ExpoPushReceipt,
  type ExpoPushTicket,
} from 'expo-server-sdk';

/**
 * Fachada fina sobre o `expo-server-sdk`, para os jobs serem testados sem rede.
 *
 * Fica na 5.x de propósito: a 6.0 virou ESM e a 8.x exige Node >= 22.12, e o
 * build do Nest é CommonJS sobre `node:22-slim`.
 *
 * Limites do Expo: 100 mensagens por requisição e 1000 ids por consulta de
 * receipt (os métodos de chunk do SDK já respeitam), 4096 bytes de payload e
 * 600 notificações/s por projeto. O SDK repete sozinho em 429.
 */
@Injectable()
export class ExpoPushClient {
  private readonly expo: Expo;

  constructor(config: ConfigService) {
    // Sem token o Expo aceita o envio; se o "Enhanced Push Security" for
    // ligado no projeto, requisição sem token passa a voltar UNAUTHORIZED.
    const accessToken = config.get<string>('EXPO_ACCESS_TOKEN');
    this.expo = new Expo(accessToken ? { accessToken } : {});
  }

  chunkMessages(messages: ExpoPushMessage[]): ExpoPushMessage[][] {
    return this.expo.chunkPushNotifications(messages);
  }

  send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    return this.expo.sendPushNotificationsAsync(messages);
  }

  chunkReceiptIds(ids: string[]): string[][] {
    return this.expo.chunkPushNotificationReceiptIds(ids);
  }

  getReceipts(ids: string[]): Promise<Record<string, ExpoPushReceipt>> {
    return this.expo.getPushNotificationReceiptsAsync(ids);
  }
}

/** Mostra só o começo do token: o token inteiro nunca vai para log. */
export function maskToken(token: string): string {
  return `${token.slice(0, 22)}…`;
}
