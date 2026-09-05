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

  const http = (service as unknown as { http: { delete: unknown } }).http;
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
