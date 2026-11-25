import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import {
  CreateBankAccountDto,
  CreateOnrampDto,
  CreateReceiverDto,
  OnrampQuoteDto,
} from './ramp.dto';

/** Mesmas opções do ValidationPipe global (main.ts). */
async function check<T extends object>(
  cls: new () => T,
  payload: unknown,
): Promise<{ dto: T; paths: string[] }> {
  const dto = plainToInstance(cls, payload);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const flatten = (list: ValidationError[], prefix = ''): string[] =>
    list.flatMap((e) => {
      const path = prefix ? `${prefix}.${e.property}` : e.property;
      return e.children?.length ? flatten(e.children, path) : [path];
    });
  return { dto, paths: flatten(errors) };
}

const SPEI = {
  beneficiaryName: 'Juan Pérez',
  speiClabe: '012345678901234567',
};
const ACH_COP = {
  beneficiaryFirstName: 'Andrés',
  beneficiaryLastName: 'Rojas',
  documentType: 'CC',
  documentId: '1234567890',
  email: 'andres@example.com',
  bankCode: '007',
  bankAccount: '123456789',
  accountType: 'saving',
};

describe('CreateReceiverDto', () => {
  const base = { userId: 'u1', email: 'a@example.com' };

  it('aceita o payload atual do app, sem country', async () => {
    const { paths, dto } = await check(CreateReceiverDto, base);
    expect(paths).toEqual([]);
    expect(dto.country).toBeUndefined();
  });

  it('normaliza country e idDocCountry', async () => {
    const { paths, dto } = await check(CreateReceiverDto, {
      ...base,
      country: ' mx ',
      idDocCountry: 'co',
    });
    expect(paths).toEqual([]);
    expect(dto.country).toBe('MX');
    expect(dto.idDocCountry).toBe('CO');
  });

  // País fora do registry passa aqui e sai como RAMP_COUNTRY_UNSUPPORTED no
  // service — o DTO só garante o formato.
  it('aceita país de 2 letras fora do registry', async () => {
    expect(
      (await check(CreateReceiverDto, { ...base, country: 'CL' })).paths,
    ).toEqual([]);
  });

  it.each([['BRA'], [''], [55]])('recusa country %p', async (country) => {
    expect(
      (await check(CreateReceiverDto, { ...base, country })).paths,
    ).toContain('country');
  });

  it('aceita os campos enhanced', async () => {
    const { paths } = await check(CreateReceiverDto, {
      ...base,
      country: 'CO',
      sourceOfFundsDocType: 'salary',
      sourceOfFundsDocFile: 'https://files.example.com/doc.pdf',
      purposeOfTransactions: 'other',
      purposeOfTransactionsExplanation: 'Poupança',
    });
    expect(paths).toEqual([]);
  });

  it('exige URL em sourceOfFundsDocFile', async () => {
    expect(
      (
        await check(CreateReceiverDto, {
          ...base,
          sourceOfFundsDocFile: 'not a url',
        })
      ).paths,
    ).toContain('sourceOfFundsDocFile');
  });

  it("mantém 'light' aceito por compatibilidade", async () => {
    expect(
      (await check(CreateReceiverDto, { ...base, kycType: 'light' })).paths,
    ).toEqual([]);
  });
});

describe('CreateBankAccountDto', () => {
  const base = { userId: 'u1', name: 'Conta' };

  it('aceita o payload Pix atual', async () => {
    expect(
      (await check(CreateBankAccountDto, { ...base, pixKey: 'a@pix' })).paths,
    ).toEqual([]);
  });

  it('aceita spei e instancia a classe aninhada', async () => {
    const { paths, dto } = await check(CreateBankAccountDto, {
      ...base,
      spei: SPEI,
    });
    expect(paths).toEqual([]);
    expect(dto.spei?.constructor.name).toBe('SpeiBankDetailsDto');
  });

  it('recusa chave desconhecida dentro de spei', async () => {
    expect(
      (
        await check(CreateBankAccountDto, {
          ...base,
          spei: { ...SPEI, clabeExtra: 'x' },
        })
      ).paths,
    ).toContain('spei.clabeExtra');
  });

  it('recusa CLABE com caracteres não numéricos', async () => {
    expect(
      (
        await check(CreateBankAccountDto, {
          ...base,
          spei: { ...SPEI, speiClabe: '0123-4567' },
        })
      ).paths,
    ).toContain('spei.speiClabe');
  });

  it('recusa spei que não é objeto', async () => {
    expect(
      (await check(CreateBankAccountDto, { ...base, spei: 'x' })).paths,
    ).toContain('spei');
  });

  it.each([
    ['transfersType', { transfersType: 'IBAN' }],
    ['beneficiaryName', { beneficiaryName: '' }],
  ])('recusa transfers.%s inválido', async (field, override) => {
    const transfers = {
      transfersType: 'CVU',
      transfersAccount: '0000003100012345678901',
      beneficiaryName: 'Lucía',
      ...override,
    };
    expect(
      (await check(CreateBankAccountDto, { ...base, transfers })).paths,
    ).toContain(`transfers.${field}`);
  });

  it('aceita achCop válido', async () => {
    expect(
      (await check(CreateBankAccountDto, { ...base, achCop: ACH_COP })).paths,
    ).toEqual([]);
  });

  it.each([
    ['documentType', { documentType: 'RUT' }],
    ['email', { email: 'nope' }],
    ['accountType', { accountType: 'current' }],
    ['bankAccount', { bankAccount: '12a' }],
  ])('recusa achCop.%s inválido', async (field, override) => {
    expect(
      (
        await check(CreateBankAccountDto, {
          ...base,
          achCop: { ...ACH_COP, ...override },
        })
      ).paths,
    ).toContain(`achCop.${field}`);
  });
});

describe.each([
  ['OnrampQuoteDto', OnrampQuoteDto],
  ['CreateOnrampDto', CreateOnrampDto],
] as const)('%s', (_name, cls) => {
  const base = { userId: 'u1', blockchainWalletId: 'w1' };

  it('segue aceitando amountBrl', async () => {
    expect((await check(cls, { ...base, amountBrl: 1000 })).paths).toEqual([]);
  });

  it('aceita amountFiat inteiro positivo', async () => {
    expect((await check(cls, { ...base, amountFiat: 1000 })).paths).toEqual([]);
    expect((await check(cls, { ...base, amountFiat: 0 })).paths).toContain(
      'amountFiat',
    );
    expect((await check(cls, { ...base, amountFiat: 10.5 })).paths).toContain(
      'amountFiat',
    );
  });

  it('aceita transfersPayer e psePayer', async () => {
    const { paths } = await check(cls, {
      ...base,
      amountFiat: 1000,
      transfersPayer: { allowedTaxId: '20-12345678-6' },
      psePayer: {
        fullName: 'Andrés Rojas',
        documentType: 'CC',
        documentNumber: '1234567890',
        email: 'andres@example.com',
        phone: '+573001234567',
        bankCode: '1007',
      },
    });
    // Combinação inválida por rail é regra do service (PAYER_RULES_MISMATCH).
    expect(paths).toEqual([]);
  });

  it('recusa psePayer.documentType fora de CC/NIT e chave desconhecida', async () => {
    const { paths } = await check(cls, {
      ...base,
      psePayer: {
        fullName: 'Andrés',
        documentType: 'CE',
        documentNumber: '1',
        email: 'andres@example.com',
        phone: '+573001234567',
        bankCode: '1',
        extra: true,
      },
    });
    expect(paths).toEqual(
      expect.arrayContaining(['psePayer.documentType', 'psePayer.extra']),
    );
  });
});
