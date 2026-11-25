/**
 * Registry dos rails de ramp BlindPay por país.
 *
 * É a única fonte de verdade sobre o que muda entre países (moeda, método de
 * payin, tipo de conta, regras de pagador e de KYC). O resto do código pergunta
 * ao rail em vez de testar `country === 'MX'` — adicionar um país é adicionar
 * uma linha aqui, não caçar condicionais espalhadas.
 *
 * Arquivo puro (sem Nest): os erros HTTP ficam em `ramp-rail-validation.ts`.
 */

export type RampCountry = 'BR' | 'MX' | 'AR' | 'CO';
export type FiatCurrency = 'BRL' | 'MXN' | 'ARS' | 'COP';
export type PayinMethod = 'pix' | 'spei' | 'transfers' | 'pse';
export type BankAccountType =
  | 'pix'
  | 'spei_bitso'
  | 'transfers_bitso'
  | 'ach_cop_bitso';
/** Chave do objeto de detalhes bancários no DTO de criação de conta. */
export type BankDetailsKey = 'pixKey' | 'spei' | 'transfers' | 'achCop';
/** Qual objeto `payer_rules` o payin quote do rail exige (ou nenhum). */
export type PayerRulesKind = 'transfers' | 'pse' | null;
export type IdDocType = 'PASSPORT' | 'ID_CARD' | 'DRIVERS';

export interface RampRail {
  country: RampCountry;
  currency: FiatCurrency;
  payinMethod: PayinMethod;
  bankAccountType: BankAccountType;
  bankDetailsKey: BankDetailsKey;
  payerRules: PayerRulesKind;
  /**
   * Com currency_type 'sender', a BlindPay exige request_amount múltiplo de
   * 100 em MXN/ARS/COP (`request_amount_must_be_a_whole_currency_unit`).
   */
  wholeUnitOnly: boolean;
  kyc: {
    /** País de alto risco: pessoa física só passa com kyc_type 'enhanced'. */
    individualRequiresEnhanced: boolean;
    /** Tipos de documento recusados quando o documento é deste país. */
    disallowedIdDocTypes: readonly IdDocType[];
  };
}

export const DEFAULT_RAMP_COUNTRY: RampCountry = 'BR';

export const RAMP_RAILS: Readonly<Record<RampCountry, RampRail>> = {
  BR: {
    country: 'BR',
    currency: 'BRL',
    payinMethod: 'pix',
    bankAccountType: 'pix',
    bankDetailsKey: 'pixKey',
    payerRules: null,
    wholeUnitOnly: false,
    kyc: { individualRequiresEnhanced: false, disallowedIdDocTypes: [] },
  },
  MX: {
    country: 'MX',
    currency: 'MXN',
    payinMethod: 'spei',
    bankAccountType: 'spei_bitso',
    bankDetailsKey: 'spei',
    payerRules: null,
    wholeUnitOnly: true,
    kyc: { individualRequiresEnhanced: false, disallowedIdDocTypes: [] },
  },
  AR: {
    country: 'AR',
    currency: 'ARS',
    payinMethod: 'transfers',
    bankAccountType: 'transfers_bitso',
    bankDetailsKey: 'transfers',
    payerRules: 'transfers',
    wholeUnitOnly: true,
    kyc: { individualRequiresEnhanced: false, disallowedIdDocTypes: [] },
  },
  CO: {
    country: 'CO',
    currency: 'COP',
    payinMethod: 'pse',
    bankAccountType: 'ach_cop_bitso',
    bankDetailsKey: 'achCop',
    payerRules: 'pse',
    wholeUnitOnly: true,
    kyc: {
      individualRequiresEnhanced: true,
      disallowedIdDocTypes: ['DRIVERS'],
    },
  },
};

export const RAMP_COUNTRIES = Object.keys(RAMP_RAILS) as RampCountry[];

export function isRampCountry(value: unknown): value is RampCountry {
  return (
    typeof value === 'string' && (RAMP_COUNTRIES as string[]).includes(value)
  );
}

/** Normaliza (trim + upper). Devolve `null` para país fora do registry. */
export function findRampRail(country: string): RampRail | null {
  const normalized = country.trim().toUpperCase();
  return isRampCountry(normalized) ? RAMP_RAILS[normalized] : null;
}

/** Rail da moeda dada (cada moeda tem um único rail); `null` se desconhecida. */
export function findRailForCurrency(currency: string): RampRail | null {
  return (
    Object.values(RAMP_RAILS).find((rail) => rail.currency === currency) ?? null
  );
}

/** Rail que emite contas do tipo dado; `null` para tipo desconhecido. */
export function findRailForBankAccountType(type: string): RampRail | null {
  return (
    Object.values(RAMP_RAILS).find((rail) => rail.bankAccountType === type) ??
    null
  );
}
