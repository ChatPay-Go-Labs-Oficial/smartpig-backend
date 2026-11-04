import { Keypair } from '@stellar/stellar-sdk';
import { HorizonPaymentsClient } from './horizon-payments.client';

const ADDRESS = Keypair.random().publicKey();

function createClient(get: jest.Mock) {
  const config = { get: jest.fn(), getOrThrow: jest.fn(() => 'https://h') };
  const client = new HorizonPaymentsClient(config as never);
  (client as unknown as { http: { get: jest.Mock } }).http = { get };
  return client;
}

const notFound = Object.assign(new Error('Not Found'), {
  isAxiosError: true,
  response: { status: 404 },
});

describe('HorizonPaymentsClient', () => {
  it('latestCursor lê o pagamento mais recente', async () => {
    const get = jest.fn().mockResolvedValue({
      data: { _embedded: { records: [{ paging_token: '123' }] } },
    });

    await expect(createClient(get).latestCursor(ADDRESS)).resolves.toBe('123');
    expect(get).toHaveBeenCalledWith(`/accounts/${ADDRESS}/payments`, {
      params: { order: 'desc', limit: 1 },
    });
  });

  it('latestCursor devolve "0" para conta sem pagamentos ou inexistente', async () => {
    const empty = jest
      .fn()
      .mockResolvedValue({ data: { _embedded: { records: [] } } });
    await expect(createClient(empty).latestCursor(ADDRESS)).resolves.toBe('0');

    const missing = jest.fn().mockRejectedValue(notFound);
    await expect(createClient(missing).latestCursor(ADDRESS)).resolves.toBe(
      '0',
    );
  });

  it('paymentsAfter pede em ordem crescente a partir do cursor', async () => {
    const get = jest.fn().mockResolvedValue({
      data: { _embedded: { records: [{ id: 'p1' }] } },
    });

    await expect(
      createClient(get).paymentsAfter(ADDRESS, '10', 50),
    ).resolves.toEqual([{ id: 'p1' }]);
    expect(get).toHaveBeenCalledWith(`/accounts/${ADDRESS}/payments`, {
      params: { order: 'asc', cursor: '10', limit: 50 },
    });
  });

  it('paymentsAfter devolve vazio para conta ainda não criada', async () => {
    const get = jest.fn().mockRejectedValue(notFound);
    await expect(
      createClient(get).paymentsAfter(ADDRESS, '0', 50),
    ).resolves.toEqual([]);
  });

  it('recusa endereço que não é chave pública Stellar', async () => {
    const get = jest.fn();
    await expect(
      createClient(get).paymentsAfter('deleted:w1', '0', 50),
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });
});
