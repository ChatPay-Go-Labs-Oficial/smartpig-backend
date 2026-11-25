import { BadRequestException } from '@nestjs/common';
import { RAMP_RAILS } from './ramp-rails';
import {
  PSE_PHONE_REGEX,
  assertEnhancedFields,
  assertIdDocAllowed,
  bankAccountParamsFromStored,
  buildBankAccountParams,
  buildPayerRules,
  buildReceiverParams,
  extractPaymentInstructions,
  getRampRail,
  railForBankAccountType,
  resolveFiatAmount,
  resolveKycType,
  rowCurrency,
} from './ramp-rail-validation';

const { BR, MX, AR, CO } = RAMP_RAILS;

/** Executa e devolve o corpo do 400, para checar `code` e `fields`. */
function errorOf(fn: () => unknown): Record<string, unknown> {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return (err as BadRequestException).getResponse() as Record<
      string,
      unknown
    >;
  }
  throw new Error('esperava BadRequestException');
}

const SPEI = {
  beneficiaryName: 'Juan Pérez',
  speiClabe: '012345678901234567',
};
const TRANSFERS = {
  transfersType: 'CVU' as const,
  transfersAccount: '0000003100012345678901',
  beneficiaryName: 'Lucía Gómez',
};
const ACH_COP = {
  beneficiaryFirstName: 'Andrés',
  beneficiaryLastName: 'Rojas',
  documentType: 'CC' as const,
  documentId: '1234567890',
  email: 'andres@example.com',
  bankCode: '007',
  bankAccount: '123456789',
  accountType: 'saving' as const,
};
const PSE_PAYER = {
  fullName: 'Andrés Rojas',
  documentType: 'CC' as const,
  documentNumber: '1234567890',
  email: 'andres@example.com',
  phone: '+573001234567',
  bankCode: '1007',
};

describe('ramp-rail-validation', () => {
  describe('resolução de rail', () => {
    it('cai em BR quando o país não veio', () => {
      expect(getRampRail(undefined)).toBe(BR);
      expect(getRampRail(null)).toBe(BR);
    });

    it('normaliza o país', () => {
      expect(getRampRail(' mx ')).toBe(MX);
    });

    it('recusa país fora do registry com RAMP_COUNTRY_UNSUPPORTED', () => {
      expect(errorOf(() => getRampRail('CL'))).toMatchObject({
        statusCode: 400,
        code: 'RAMP_COUNTRY_UNSUPPORTED',
        fields: { country: expect.any(String) },
      });
    });

    it('conta sem type é Pix (legado)', () => {
      expect(railForBankAccountType(undefined)).toBe(BR);
      expect(railForBankAccountType('ach_cop_bitso')).toBe(CO);
      expect(errorOf(() => railForBankAccountType('wire')).code).toBe(
        'RAMP_COUNTRY_UNSUPPORTED',
      );
    });

    it('rowCurrency trata row sem fiatCurrency como BRL', () => {
      expect(rowCurrency({})).toBe('BRL');
      expect(rowCurrency({ fiatCurrency: null })).toBe('BRL');
      expect(rowCurrency({ fiatCurrency: 'MXN' })).toBe('MXN');
    });
  });

  describe('KYC', () => {
    it.each([
      [BR, undefined, undefined, 'standard'],
      [BR, undefined, 'light', 'standard'],
      [BR, undefined, 'enhanced', 'enhanced'],
      [MX, 'individual', 'standard', 'standard'],
      [AR, undefined, 'light', 'standard'],
      [CO, undefined, 'standard', 'enhanced'],
      [CO, 'individual', 'light', 'enhanced'],
      [CO, 'business', 'standard', 'standard'],
    ] as const)(
      '%#: %o type=%s kycType=%s → %s',
      (rail, type, kycType, expected) => {
        expect(resolveKycType(rail, { type, kycType })).toBe(expected);
      },
    );

    it('enhanced exige origem dos recursos e finalidade', () => {
      const body = errorOf(() =>
        assertEnhancedFields({ email: 'a@b.co' }, 'enhanced'),
      );
      expect(body.code).toBe('KYC_ENHANCED_FIELDS_REQUIRED');
      expect(Object.keys(body.fields as object).sort()).toEqual([
        'purposeOfTransactions',
        'sourceOfFundsDocFile',
        'sourceOfFundsDocType',
      ]);
    });

    it('purpose "other" exige explicação', () => {
      const dto = {
        email: 'a@b.co',
        sourceOfFundsDocType: 'salary' as const,
        sourceOfFundsDocFile: 'https://files/doc.pdf',
        purposeOfTransactions: 'other' as const,
      };
      expect(
        errorOf(() => assertEnhancedFields(dto, 'enhanced')).fields,
      ).toEqual({ purposeOfTransactionsExplanation: expect.any(String) });
      expect(() =>
        assertEnhancedFields(
          { ...dto, purposeOfTransactionsExplanation: 'Poupança pessoal' },
          'enhanced',
        ),
      ).not.toThrow();
    });

    it('standard não exige campos enhanced', () => {
      expect(() =>
        assertEnhancedFields({ email: 'a@b.co' }, 'standard'),
      ).not.toThrow();
    });

    it.each([
      [CO, undefined, 'DRIVERS', true],
      [CO, 'co', 'DRIVERS', true],
      [BR, 'CO', 'DRIVERS', true],
      [CO, 'US', 'DRIVERS', false],
      [CO, undefined, 'PASSPORT', false],
      [MX, undefined, 'DRIVERS', false],
    ] as const)(
      '%#: idDocCountry=%s idDocType=%s → recusa=%s',
      (rail, idDocCountry, idDocType, rejects) => {
        const run = () => assertIdDocAllowed(rail, { idDocCountry, idDocType });
        if (rejects) {
          expect(errorOf(run)).toMatchObject({
            code: 'KYC_ID_DOC_TYPE_NOT_ALLOWED',
            fields: { idDocType: expect.any(String) },
          });
        } else {
          expect(run).not.toThrow();
        }
      },
    );

    it('buildReceiverParams usa o país do rail e mapeia os campos enhanced', () => {
      const params = buildReceiverParams(
        {
          email: 'a@b.co',
          firstName: 'Andrés',
          idDocCountry: ' co ',
          idDocType: 'PASSPORT',
          sourceOfFundsDocType: 'salary' as const,
          sourceOfFundsDocFile: 'https://files/doc.pdf',
          purposeOfTransactions: 'other' as const,
          purposeOfTransactionsExplanation: 'Poupança',
          tosId: 'to_1',
        },
        CO,
        'enhanced',
      );
      expect(params).toMatchObject({
        type: 'individual',
        kyc_type: 'enhanced',
        country: 'CO',
        email: 'a@b.co',
        first_name: 'Andrés',
        id_doc_country: 'CO',
        id_doc_type: 'PASSPORT',
        tos_id: 'to_1',
        source_of_funds_doc_type: 'salary',
        source_of_funds_doc_file: 'https://files/doc.pdf',
        purpose_of_transactions: 'other',
        purpose_of_transactions_explanation: 'Poupança',
      });
    });
  });

  describe('contas bancárias', () => {
    it('BR mantém o payload Pix atual, sem details', () => {
      expect(buildBankAccountParams(BR, 'Conta', { pixKey: 'a@pix' })).toEqual({
        params: { type: 'pix', name: 'Conta', pix_key: 'a@pix' },
        pixKey: 'a@pix',
        details: null,
      });
      // Chave Pix continua opcional, como antes.
      expect(buildBankAccountParams(BR, 'Conta', {}).params).toEqual({
        type: 'pix',
        name: 'Conta',
        pix_key: undefined,
      });
    });

    it('MX monta spei_bitso com protocolo clabe por default', () => {
      const built = buildBankAccountParams(MX, 'Conta', { spei: SPEI });
      expect(built.params).toEqual({
        type: 'spei_bitso',
        name: 'Conta',
        beneficiary_name: 'Juan Pérez',
        spei_protocol: 'clabe',
        spei_clabe: '012345678901234567',
        spei_institution_code: null,
      });
      expect(built.pixKey).toBeNull();
      expect(built.details).toEqual({
        beneficiary_name: 'Juan Pérez',
        spei_protocol: 'clabe',
        spei_clabe: '012345678901234567',
        spei_institution_code: null,
      });
    });

    it('AR monta transfers_bitso', () => {
      expect(
        buildBankAccountParams(AR, 'Conta', { transfers: TRANSFERS }).params,
      ).toEqual({
        type: 'transfers_bitso',
        name: 'Conta',
        beneficiary_name: 'Lucía Gómez',
        transfers_type: 'CVU',
        transfers_account: '0000003100012345678901',
      });
    });

    it('CO monta ach_cop_bitso', () => {
      expect(
        buildBankAccountParams(CO, 'Conta', { achCop: ACH_COP }).params,
      ).toEqual({
        type: 'ach_cop_bitso',
        name: 'Conta',
        ach_cop_beneficiary_first_name: 'Andrés',
        ach_cop_beneficiary_last_name: 'Rojas',
        ach_cop_document_id: '1234567890',
        ach_cop_document_type: 'CC',
        ach_cop_email: 'andres@example.com',
        ach_cop_bank_code: '007',
        ach_cop_bank_account: '123456789',
        account_type: 'saving',
      });
    });

    it.each([
      [MX, 'spei'],
      [AR, 'transfers'],
      [CO, 'achCop'],
    ] as const)('%#: sem "%s" → REQUIRED', (rail, key) => {
      expect(
        errorOf(() => buildBankAccountParams(rail, 'Conta', {})),
      ).toMatchObject({
        code: 'BANK_ACCOUNT_DETAILS_REQUIRED',
        fields: { [key]: expect.any(String) },
      });
    });

    it.each([
      [BR, { spei: SPEI }, 'spei'],
      [MX, { pixKey: 'a@pix', spei: SPEI }, 'pixKey'],
      [AR, { achCop: ACH_COP }, 'achCop'],
      [CO, { transfers: TRANSFERS, achCop: ACH_COP }, 'transfers'],
    ] as const)(
      '%#: detalhes de outro rail → MISMATCH (%o)',
      (rail, dto, key) => {
        expect(
          errorOf(() => buildBankAccountParams(rail, 'Conta', dto)),
        ).toMatchObject({
          code: 'BANK_ACCOUNT_DETAILS_MISMATCH',
          fields: { [key]: expect.any(String) },
        });
      },
    );

    it.each([
      [MX, { spei: { ...SPEI, speiClabe: '1234' } }, 'spei.speiClabe'],
      [
        MX,
        { spei: { ...SPEI, speiClabe: '01234567890123456a' } },
        'spei.speiClabe',
      ],
      [
        MX,
        {
          spei: {
            ...SPEI,
            speiProtocol: 'debitcard',
            speiClabe: '4111111111111111',
          },
        },
        'spei.speiInstitutionCode',
      ],
      [
        AR,
        { transfers: { ...TRANSFERS, transfersAccount: '123' } },
        'transfers.transfersAccount',
      ],
      [
        AR,
        {
          transfers: {
            ...TRANSFERS,
            transfersType: 'ALIAS' as const,
            transfersAccount: 'ab',
          },
        },
        'transfers.transfersAccount',
      ],
      [CO, { achCop: { ...ACH_COP, documentId: '12' } }, 'achCop.documentId'],
      [
        CO,
        {
          achCop: {
            ...ACH_COP,
            documentType: 'CE' as const,
            documentId: '12345',
          },
        },
        'achCop.documentId',
      ],
      [
        CO,
        {
          achCop: {
            ...ACH_COP,
            documentType: 'NIT' as const,
            documentId: '12345678',
          },
        },
        'achCop.documentId',
      ],
      [
        CO,
        {
          achCop: {
            ...ACH_COP,
            documentType: 'PASS' as const,
            documentId: 'AB-123',
          },
        },
        'achCop.documentId',
      ],
      [
        CO,
        {
          achCop: {
            ...ACH_COP,
            documentType: 'PEP' as const,
            documentId: '  ',
          },
        },
        'achCop.documentId',
      ],
      [
        CO,
        { achCop: { ...ACH_COP, bankAccount: '12-34' } },
        'achCop.bankAccount',
      ],
    ])('%#: formato inválido → INVALID em %s', (rail, dto, field) => {
      const body = errorOf(() => buildBankAccountParams(rail, 'Conta', dto));
      expect(body.code).toBe('BANK_ACCOUNT_DETAILS_INVALID');
      expect(body.fields).toHaveProperty([field]);
    });

    it.each([
      [
        {
          ...SPEI,
          speiProtocol: 'phonenum',
          speiClabe: '5512345678',
          speiInstitutionCode: '40012',
        },
      ],
    ])('SPEI aceita protocolo não-clabe com instituição', (spei) => {
      expect(buildBankAccountParams(MX, 'Conta', { spei }).details).toEqual({
        beneficiary_name: 'Juan Pérez',
        spei_protocol: 'phonenum',
        spei_clabe: '5512345678',
        spei_institution_code: '40012',
      });
    });

    it('SPEI clabe manda spei_institution_code null (chave sempre presente, como no SDK)', () => {
      const { params, details } = buildBankAccountParams(MX, 'Conta', {
        spei: SPEI,
      });
      expect(params).toHaveProperty('spei_institution_code', null);
      expect(details).toHaveProperty('spei_institution_code', null);
    });

    it('SPEI recusa protocolo fora de clabe/debitcard/phonenum', () => {
      const body = errorOf(() =>
        buildBankAccountParams(MX, 'Conta', {
          spei: { ...SPEI, speiProtocol: 'iban' },
        }),
      );
      expect(body.code).toBe('BANK_ACCOUNT_DETAILS_INVALID');
      expect(body.fields).toHaveProperty(['spei.speiProtocol']);
    });

    it.each([
      ['CC', '123'],
      ['CE', '123456'],
      ['NIT', '900123456'],
      ['NIT', '9001234567'],
      ['PASS', 'AB12345'],
      ['PEP', 'X-1'],
    ] as const)('aceita documento %s %s', (documentType, documentId) => {
      expect(() =>
        buildBankAccountParams(CO, 'Conta', {
          achCop: { ...ACH_COP, documentType, documentId },
        }),
      ).not.toThrow();
    });

    it('aceita alias argentino válido', () => {
      expect(() =>
        buildBankAccountParams(AR, 'Conta', {
          transfers: {
            ...TRANSFERS,
            transfersType: 'ALIAS',
            transfersAccount: 'mi.alias-01',
          },
        }),
      ).not.toThrow();
    });

    it("normaliza speiProtocol: ' CLABE ' vira 'clabe' e exige 18 dígitos", () => {
      expect(
        buildBankAccountParams(MX, 'Conta', {
          spei: { ...SPEI, speiProtocol: ' CLABE ' },
        }).params,
      ).toMatchObject({ spei_protocol: 'clabe' });
      expect(
        errorOf(() =>
          buildBankAccountParams(MX, 'Conta', {
            spei: { ...SPEI, speiProtocol: 'CLABE', speiClabe: '1234' },
          }),
        ).fields,
      ).toHaveProperty(['spei.speiClabe']);
    });

    it("'DEBITCARD' também exige instituição e vai em minúsculas", () => {
      const spei = {
        ...SPEI,
        speiProtocol: 'DEBITCARD',
        speiClabe: '4111111111111111',
      };
      expect(
        errorOf(() => buildBankAccountParams(MX, 'Conta', { spei })).fields,
      ).toHaveProperty(['spei.speiInstitutionCode']);
      expect(
        buildBankAccountParams(MX, 'Conta', {
          spei: { ...spei, speiInstitutionCode: '40012' },
        }).details,
      ).toMatchObject({ spei_protocol: 'debitcard' });
    });

    describe('bankAccountParamsFromStored', () => {
      it('Pix é sempre reconstruível, inclusive sem chave e sem type', () => {
        expect(
          bankAccountParamsFromStored({ pixKey: 'a@pix' }, 'Maria'),
        ).toEqual({ type: 'pix', name: 'Maria', pix_key: 'a@pix' });
        expect(
          bankAccountParamsFromStored({ type: 'pix', pixKey: null }, 'Maria'),
        ).toEqual({ type: 'pix', name: 'Maria', pix_key: undefined });
      });

      it('recria conta não-Pix a partir de details', () => {
        const { details } = buildBankAccountParams(CO, 'Conta', {
          achCop: ACH_COP,
        });
        expect(
          bankAccountParamsFromStored(
            { type: 'ach_cop_bitso', pixKey: null, details },
            'Andrés',
          ),
        ).toEqual({ ...details, type: 'ach_cop_bitso', name: 'Andrés' });
      });

      it.each([
        [{ type: 'spei_bitso', details: null }],
        [{ type: 'spei_bitso', details: { spei_clabe: '012345678901234567' } }],
        [{ type: 'transfers_bitso', details: ['x'] }],
        [{ type: 'wire', details: { a: 'b' } }],
      ])('%#: não-Pix sem details completo → null', (stored) => {
        expect(bankAccountParamsFromStored(stored, 'X')).toBeNull();
      });
    });
  });

  describe('payer rules', () => {
    it.each([BR, MX])('%#: rail sem payer rules → undefined', (rail) => {
      expect(buildPayerRules(rail, {})).toBeUndefined();
    });

    it.each([
      [
        BR,
        { transfersPayer: { allowedTaxId: '20123456786' } },
        'transfersPayer',
      ],
      [MX, { psePayer: PSE_PAYER }, 'psePayer'],
      [
        AR,
        {
          transfersPayer: { allowedTaxId: '20123456786' },
          psePayer: PSE_PAYER,
        },
        'psePayer',
      ],
      [
        CO,
        { transfersPayer: { allowedTaxId: '20123456786' } },
        'transfersPayer',
      ],
    ])('%#: regra de outro rail → MISMATCH', (rail, dto, key) => {
      expect(errorOf(() => buildPayerRules(rail, dto))).toMatchObject({
        code: 'PAYER_RULES_MISMATCH',
        fields: { [key]: expect.any(String) },
      });
    });

    it.each([
      [AR, 'transfersPayer'],
      [CO, 'psePayer'],
    ] as const)('%#: sem regra → REQUIRED (%s)', (rail, key) => {
      expect(errorOf(() => buildPayerRules(rail, {}))).toMatchObject({
        code: 'PAYER_RULES_REQUIRED',
        fields: { [key]: expect.any(String) },
      });
    });

    it.each(['20123456786', '20-12345678-6', '20-123456786'])(
      'normaliza CUIT %s para o formato com hífen',
      (allowedTaxId) => {
        expect(
          buildPayerRules(AR, { transfersPayer: { allowedTaxId } }),
        ).toEqual({
          transfers_allowed_tax_id: '20-12345678-6',
        });
      },
    );

    it('CUIT inválido → INVALID', () => {
      expect(
        errorOf(() =>
          buildPayerRules(AR, { transfersPayer: { allowedTaxId: '2012345' } }),
        ),
      ).toMatchObject({
        code: 'PAYER_RULES_INVALID',
        fields: { 'transfersPayer.allowedTaxId': expect.any(String) },
      });
    });

    it('monta pse payer rules', () => {
      expect(buildPayerRules(CO, { psePayer: PSE_PAYER })).toEqual({
        pse_full_name: 'Andrés Rojas',
        pse_document_type: 'CC',
        pse_document_number: '1234567890',
        pse_email: 'andres@example.com',
        pse_phone: '+573001234567',
        pse_bank_code: '1007',
      });
    });

    it.each([
      ['+57300123456', true],
      ['+573001234567', true],
      ['+5730012345', false],
      ['573001234567', false],
      ['+5530012345678', false],
    ])('PSE_PHONE_REGEX %s → %s', (phone, ok) => {
      expect(PSE_PHONE_REGEX.test(phone)).toBe(ok);
    });

    it('telefone PSE inválido → INVALID', () => {
      expect(
        errorOf(() =>
          buildPayerRules(CO, {
            psePayer: { ...PSE_PAYER, phone: '3001234567' },
          }),
        ),
      ).toMatchObject({
        code: 'PAYER_RULES_INVALID',
        fields: { 'psePayer.phone': expect.any(String) },
      });
    });
  });

  describe('resolveFiatAmount', () => {
    it('amountUsd tem precedência', () => {
      expect(
        resolveFiatAmount(MX, { amountUsd: 1000, amountFiat: 1050 }),
      ).toEqual({ kind: 'usd', amount: 1000 });
    });

    it('BR aceita amountBrl ou amountFiat, centavos livres', () => {
      expect(resolveFiatAmount(BR, { amountBrl: 1050 })).toEqual({
        kind: 'fiat',
        amount: 1050,
      });
      expect(resolveFiatAmount(BR, { amountFiat: 1050 })).toEqual({
        kind: 'fiat',
        amount: 1050,
      });
    });

    it('amountFiat e amountBrl juntos → AMBIGUOUS', () => {
      expect(
        errorOf(() =>
          resolveFiatAmount(BR, { amountFiat: 1000, amountBrl: 1000 }),
        ).code,
      ).toBe('AMOUNT_AMBIGUOUS');
    });

    it.each([MX, AR, CO])(
      '%#: amountBrl fora de BRL → CURRENCY_MISMATCH',
      (rail) => {
        expect(
          errorOf(() => resolveFiatAmount(rail, { amountBrl: 1000 })).code,
        ).toBe('AMOUNT_CURRENCY_MISMATCH');
      },
    );

    it('nada informado → AMOUNT_REQUIRED', () => {
      expect(errorOf(() => resolveFiatAmount(BR, {}))).toMatchObject({
        code: 'AMOUNT_REQUIRED',
        message: 'Informe amountFiat, amountBrl ou amountUsd',
      });
    });

    it.each([MX, AR, CO])(
      '%#: exige unidade inteira e sugere valores',
      (rail) => {
        const body = errorOf(() =>
          resolveFiatAmount(rail, { amountFiat: 12345 }),
        );
        expect(body.code).toBe('AMOUNT_MUST_BE_WHOLE_UNIT');
        expect(body.message).toContain('12300 ou 12400');
        expect(resolveFiatAmount(rail, { amountFiat: 12300 })).toEqual({
          kind: 'fiat',
          amount: 12300,
        });
      },
    );

    it('abaixo de uma unidade sugere só o próximo valor', () => {
      expect(
        errorOf(() => resolveFiatAmount(MX, { amountFiat: 50 })).message,
      ).toContain('Tente 100.');
    });
  });

  describe('extractPaymentInstructions', () => {
    const empty = { pix_code: null };

    it.each([
      ['pix', { pix_code: '000201' }, { method: 'pix', pixCode: '000201' }],
      [
        'spei',
        { ...empty, clabe: '646180000000000000' },
        { method: 'spei', clabe: '646180000000000000' },
      ],
      [
        'transfers',
        {
          ...empty,
          tracking_transaction: {
            transfers_instruction: { account: '0000003100', type: 'CVU' },
          },
        },
        { method: 'transfers', account: '0000003100', accountType: 'CVU' },
      ],
      [
        'pse',
        { ...empty, pse_payment_link: 'https://pse/1' },
        { method: 'pse', paymentLink: 'https://pse/1' },
      ],
      [
        'pse',
        {
          ...empty,
          tracking_transaction: {
            pse_instruction: { payment_link: 'https://pse/2' },
          },
        },
        { method: 'pse', paymentLink: 'https://pse/2' },
      ],
    ] as const)('%s → instrução normalizada', (method, payin, expected) => {
      expect(extractPaymentInstructions(method, payin)).toEqual(expected);
    });

    it.each(['pix', 'spei', 'transfers', 'pse'] as const)(
      '%s sem o campo → null',
      (method) => {
        expect(extractPaymentInstructions(method, empty)).toBeNull();
      },
    );
  });
});
