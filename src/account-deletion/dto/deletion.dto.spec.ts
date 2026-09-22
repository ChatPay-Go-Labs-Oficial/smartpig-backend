import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmDeletionDto, RequestDeletionDto } from './deletion.dto';

async function errorsFor(cls: never, payload: unknown): Promise<string[]> {
  const dto = plainToInstance(cls, payload);
  const errors = await validate(dto as object, {
    whitelist: true,
    forbidNonWhitelisted: false,
  });
  return errors.flatMap((e) => [
    e.property,
    ...(e.children ?? []).map((c) => c.property),
  ]);
}

describe('ConfirmDeletionDto', () => {
  const full = {
    signedXdr: 'AAAA',
    acknowledgements: {
      dataRetention: true,
      onchainHistoryPublic: true,
      irreversible: true,
    },
  };

  it('accepts the three acknowledgements when all are given', async () => {
    expect(await errorsFor(ConfirmDeletionDto as never, full)).toEqual([]);
  });

  it('accepts an absent signature, for a wallet that was never activated', async () => {
    const withoutXdr = { acknowledgements: full.acknowledgements };
    expect(await errorsFor(ConfirmDeletionDto as never, withoutXdr)).toEqual(
      [],
    );
  });

  // An unticked box must be a 400, never a silent pass: the acknowledgements are
  // the evidence that the user was told what is kept and what cannot be erased.
  it.each(['dataRetention', 'onchainHistoryPublic', 'irreversible'])(
    'rejects %s when it is false',
    async (field) => {
      const payload = {
        ...full,
        acknowledgements: { ...full.acknowledgements, [field]: false },
      };
      expect(await errorsFor(ConfirmDeletionDto as never, payload)).toContain(
        field,
      );
    },
  );

  it.each(['dataRetention', 'onchainHistoryPublic', 'irreversible'])(
    'rejects %s when it is missing',
    async (field) => {
      const acknowledgements = { ...full.acknowledgements };
      delete (acknowledgements as Record<string, unknown>)[field];
      expect(
        await errorsFor(ConfirmDeletionDto as never, {
          ...full,
          acknowledgements,
        }),
      ).toContain(field);
    },
  );
});

describe('RequestDeletionDto', () => {
  it('demands a uuid v4 idempotency key', async () => {
    expect(
      await errorsFor(RequestDeletionDto as never, { idempotencyKey: 'nope' }),
    ).toContain('idempotencyKey');
  });
});
