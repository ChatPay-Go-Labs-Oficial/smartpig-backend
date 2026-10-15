import { ConfigService } from '@nestjs/config';
import { BlindPayService } from './blindpay.service';

const INSTANCE = 'inst-1';
const RECEIVER = 'cus-42';

function createService() {
  const values: Record<string, string> = {
    BLINDPAY_API_KEY: 'key',
    BLINDPAY_INSTANCE_ID: INSTANCE,
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
    ),
    getOrThrow: jest.fn((key: string) => {
      if (!(key in values)) throw new Error(`Missing ${key}`);
      return values[key];
    }),
  } as unknown as ConfigService;

  const service = new BlindPayService(config);
  service.onModuleInit();

  const http = (
    service as unknown as {
      http: { delete: unknown; post: unknown };
    }
  ).http;
  return { service, http };
}

/** Shaped like the axios error the service inspects. */
function httpError(status: number) {
  return {
    isAxiosError: true,
    response: { status, data: { message: 'nope' } },
  };
}

describe('BlindPayService.deleteCustomer', () => {
  it('deletes the customer under the configured instance', async () => {
    const { service, http } = createService();
    http.delete = jest.fn().mockResolvedValue({ data: null });

    await service.deleteCustomer(RECEIVER);

    expect(http.delete).toHaveBeenCalledWith(
      `/instances/${INSTANCE}/customers/${RECEIVER}`,
    );
  });

  it('treats 404 as success, because the customer being gone is the goal', async () => {
    // The cleanup job retries this step. Failing on 404 would make it retry
    // forever over something already done.
    const { service, http } = createService();
    http.delete = jest.fn().mockRejectedValue(httpError(404));

    await expect(service.deleteCustomer(RECEIVER)).resolves.toBeUndefined();
  });

  it('propagates any other failure, so the caller can retry later', async () => {
    const { service, http } = createService();
    http.delete = jest.fn().mockRejectedValue(httpError(500));

    await expect(service.deleteCustomer(RECEIVER)).rejects.toBeDefined();
  });
});

describe('BlindPayService.createBlockchainWallet', () => {
  /**
   * Desde 10/10/2026 a BlindPay rejeita o registro de wallet de customer
   * brasileiro sem `is_self_custody` (400 `WALLETS_SELF_CUSTODY_REQUIRED`).
   * Quem registramos é sempre a embedded wallet do próprio usuário, então o
   * default precisa sair no corpo mesmo quando o caller não diz nada.
   */
  it('declares self-custody by default, which BR customers require', async () => {
    const { service, http } = createService();
    http.post = jest.fn().mockResolvedValue({ data: { id: 'bw_1' } });

    await service.createBlockchainWallet(RECEIVER, {
      name: 'Stellar wallet for Maria',
      network: 'stellar_testnet',
      address: 'GABC',
    });

    expect(http.post).toHaveBeenCalledWith(
      `/instances/${INSTANCE}/customers/${RECEIVER}/blockchain-wallets`,
      {
        name: 'Stellar wallet for Maria',
        network: 'stellar_testnet',
        is_account_abstraction: true,
        is_self_custody: true,
        address: 'GABC',
      },
    );
  });

  it('lets the caller override the declaration', async () => {
    const { service, http } = createService();
    http.post = jest.fn().mockResolvedValue({ data: { id: 'bw_1' } });

    await service.createBlockchainWallet(RECEIVER, {
      name: 'Custodied wallet',
      network: 'stellar',
      address: 'GABC',
      is_self_custody: false,
    });

    expect(http.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ is_self_custody: false }),
    );
  });
});
