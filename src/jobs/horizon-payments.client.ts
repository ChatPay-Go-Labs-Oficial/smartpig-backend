import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StrKey } from '@stellar/stellar-sdk';
import axios, { type AxiosInstance } from 'axios';

/** Os campos de `/accounts/:id/payments` que o watcher usa. */
export interface HorizonPayment {
  id: string;
  paging_token: string;
  type: string;
  from?: string;
  to?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  amount?: string;
  transaction_hash: string;
  transaction_successful?: boolean;
  created_at: string;
}

interface PaymentsPage {
  _embedded?: { records?: HorizonPayment[] };
}

/**
 * Leitura de pagamentos no Horizon, com timeout (mesmo padrão do QuoteService).
 * O endpoint `/payments` já exclui transações que falharam por padrão.
 */
@Injectable()
export class HorizonPaymentsClient {
  private http: AxiosInstance;

  constructor(config: ConfigService) {
    this.http = axios.create({
      baseURL: config.getOrThrow<string>('STELLAR_HORIZON_URL'),
      timeout: config.get<number>('STELLAR_HORIZON_TIMEOUT_MS', 15_000),
    });
  }

  /**
   * paging_token do pagamento mais recente, para virar a linha de base de uma
   * carteira nova. "0" quando não há pagamento ou a conta ainda não existe na
   * rede: tudo o que chegar depois é novo.
   */
  async latestCursor(address: string): Promise<string> {
    const records = await this.fetch(address, { order: 'desc', limit: 1 });
    return records[0]?.paging_token ?? '0';
  }

  /** Pagamentos depois do cursor, do mais antigo para o mais novo. */
  paymentsAfter(
    address: string,
    cursor: string,
    limit: number,
  ): Promise<HorizonPayment[]> {
    return this.fetch(address, { order: 'asc', cursor, limit });
  }

  private async fetch(
    address: string,
    params: Record<string, string | number>,
  ): Promise<HorizonPayment[]> {
    // Carteira excluída tem a sentinela "deleted:<id>" no lugar do endereço;
    // nada que não seja chave pública vai para a URL.
    if (!StrKey.isValidEd25519PublicKey(address)) {
      throw new Error('Endereço Stellar inválido para consulta de pagamentos');
    }
    try {
      const { data } = await this.http.get<PaymentsPage>(
        `/accounts/${address}/payments`,
        { params },
      );
      return data?._embedded?.records ?? [];
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return [];
      }
      throw error;
    }
  }
}
