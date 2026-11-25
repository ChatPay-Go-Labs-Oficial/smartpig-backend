import { BadRequestException } from '@nestjs/common';
import type {
  BlindPayPayerRules,
  BlindPayPayin,
  CreateBankAccountParams,
  CreateReceiverParams,
} from '../blindpay/dto/blindpay.dto';
import {
  DEFAULT_RAMP_COUNTRY,
  RAMP_COUNTRIES,
  findRailForBankAccountType,
  findRailForCurrency,
  findRampRail,
  type BankAccountType,
  type BankDetailsKey,
  type IdDocType,
  type PayinMethod,
  type RampRail,
} from './ramp-rails';

/**
 * Validações puras do fluxo multi-rail. Tudo que depende do país passa pelo
 * rail (ver `ramp-rails.ts`); aqui só ficam as regras de formato e a montagem
 * dos payloads da BlindPay, para que `RampService` e `RampKycService` usem
 * exatamente o mesmo caminho.
 */

export type RampRailErrorCode =
  | 'RAMP_COUNTRY_UNSUPPORTED'
  | 'RECEIVER_COUNTRY_MISMATCH'
  | 'KYC_ENHANCED_FIELDS_REQUIRED'
  | 'KYC_ID_DOC_TYPE_NOT_ALLOWED'
  | 'BANK_ACCOUNT_DETAILS_REQUIRED'
  | 'BANK_ACCOUNT_DETAILS_MISMATCH'
  | 'BANK_ACCOUNT_DETAILS_INVALID'
  | 'BANK_ACCOUNT_NOT_REBUILDABLE'
  | 'PAYER_RULES_REQUIRED'
  | 'PAYER_RULES_MISMATCH'
  | 'PAYER_RULES_INVALID'
  | 'AMOUNT_REQUIRED'
  | 'AMOUNT_AMBIGUOUS'
  | 'AMOUNT_CURRENCY_MISMATCH'
  | 'AMOUNT_MUST_BE_WHOLE_UNIT';

/** Mesmo shape de erro de KYC_NOT_REJECTED / RFI_INVALID. */
export function railError(
  code: RampRailErrorCode,
  message: string,
  fields?: Record<string, string>,
): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code,
    message,
    ...(fields ? { fields } : {}),
  });
}

// ─── Resolução de rail ────────────────────────────────────────────────────────

/**
 * Rail do país. Ausente cai em BR: o app atual não manda `country`, e todo
 * receiver criado antes do multi-rail é brasileiro.
 */
export function getRampRail(country?: string | null): RampRail {
  const rail = findRampRail(country ?? DEFAULT_RAMP_COUNTRY);
  if (!rail) {
    throw railError(
      'RAMP_COUNTRY_UNSUPPORTED',
      `País não suportado no ramp. Use um destes: ${RAMP_COUNTRIES.join(', ')}.`,
      { country: 'País não suportado.' },
    );
  }
  return rail;
}

/** Rail de uma conta salva. Tipo ausente é conta Pix (formato legado). */
export function railForBankAccountType(type?: string | null): RampRail {
  const rail = findRailForBankAccountType(type ?? 'pix');
  if (!rail) {
    throw railError(
      'RAMP_COUNTRY_UNSUPPORTED',
      'Tipo de conta bancária não suportado no ramp.',
    );
  }
  return rail;
}

/** Rail de uma moeda salva; `null` para moeda fora do registry. */
export function findRailForRowCurrency(row: {
  fiatCurrency?: string | null;
}): RampRail | null {
  return findRailForCurrency(rowCurrency(row));
}

/** Moeda de uma transação salva. Rows anteriores ao multi-rail são BRL. */
export function rowCurrency(row: { fiatCurrency?: string | null }): string {
  return row.fiatCurrency ?? 'BRL';
}

// ─── KYC / receiver ───────────────────────────────────────────────────────────

/** Campos do DTO de receiver que os helpers leem (CreateReceiverDto satisfaz). */
export interface ReceiverInput {
  email: string;
  type?: 'individual' | 'business';
  kycType?: 'light' | 'standard' | 'enhanced';
  firstName?: string;
  lastName?: string;
  taxId?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateProvinceRegion?: string;
  postalCode?: string;
  dateOfBirth?: string;
  idDocCountry?: string;
  idDocType?: IdDocType;
  selfieFileUrl?: string;
  idDocFrontUrl?: string;
  idDocBackUrl?: string;
  tosId?: string;
  sourceOfFundsDocType?: string;
  sourceOfFundsDocFile?: string;
  purposeOfTransactions?: string;
  purposeOfTransactionsExplanation?: string;
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

function normalizeCountry(value?: string | null): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : undefined;
}

/**
 * 'light' é sempre recusado pela BlindPay, então vira 'standard' (o mesmo
 * nível que o app já recebia por default). País de alto risco força
 * 'enhanced' para pessoa física, independente do que veio no DTO.
 */
export function resolveKycType(
  rail: RampRail,
  dto: Pick<ReceiverInput, 'type' | 'kycType'>,
): 'standard' | 'enhanced' {
  const type = dto.type ?? 'individual';
  if (type === 'individual' && rail.kyc.individualRequiresEnhanced) {
    return 'enhanced';
  }
  return dto.kycType === 'enhanced' ? 'enhanced' : 'standard';
}

/** Enhanced sem estes campos é recusado do lado da BlindPay — falha antes aqui. */
export function assertEnhancedFields(
  dto: ReceiverInput,
  kycType: 'standard' | 'enhanced',
): void {
  if (kycType !== 'enhanced') return;
  const fields: Record<string, string> = {};
  const required = 'Obrigatório para KYC enhanced.';
  if (isBlank(dto.sourceOfFundsDocType)) fields.sourceOfFundsDocType = required;
  if (isBlank(dto.sourceOfFundsDocFile)) fields.sourceOfFundsDocFile = required;
  if (isBlank(dto.purposeOfTransactions)) {
    fields.purposeOfTransactions = required;
  } else if (
    dto.purposeOfTransactions?.trim() === 'other' &&
    isBlank(dto.purposeOfTransactionsExplanation)
  ) {
    fields.purposeOfTransactionsExplanation =
      'Explique a finalidade quando ela for "other".';
  }
  if (Object.keys(fields).length > 0) {
    throw railError(
      'KYC_ENHANCED_FIELDS_REQUIRED',
      'Este país exige KYC enhanced. Envie origem dos recursos e finalidade das transações.',
      fields,
    );
  }
}

/**
 * Alguns países não aceitam certos documentos (ex.: CNH na Colômbia). O país
 * que conta é o do documento — cai no país do receiver quando não informado.
 */
export function assertIdDocAllowed(
  rail: RampRail,
  dto: Pick<ReceiverInput, 'idDocCountry' | 'idDocType'>,
): void {
  if (!dto.idDocType) return;
  const docCountry = normalizeCountry(dto.idDocCountry) ?? rail.country;
  const docRail = findRampRail(docCountry);
  if (docRail?.kyc.disallowedIdDocTypes.includes(dto.idDocType)) {
    throw railError(
      'KYC_ID_DOC_TYPE_NOT_ALLOWED',
      'Este tipo de documento não é aceito para o país do documento. Use passaporte ou documento de identidade.',
      { idDocType: 'Tipo de documento não aceito.' },
    );
  }
}

export function buildReceiverParams(
  dto: ReceiverInput,
  rail: RampRail,
  kycType: 'standard' | 'enhanced',
): CreateReceiverParams {
  return {
    type: dto.type ?? 'individual',
    kyc_type: kycType,
    email: dto.email,
    country: rail.country,
    first_name: dto.firstName,
    last_name: dto.lastName,
    tax_id: dto.taxId,
    address_line_1: dto.addressLine1,
    address_line_2: dto.addressLine2,
    city: dto.city,
    state_province_region: dto.stateProvinceRegion,
    postal_code: dto.postalCode,
    date_of_birth: dto.dateOfBirth,
    id_doc_country: normalizeCountry(dto.idDocCountry),
    id_doc_type: dto.idDocType,
    selfie_file: dto.selfieFileUrl,
    id_doc_front_file: dto.idDocFrontUrl,
    id_doc_back_file: dto.idDocBackUrl,
    tos_id: dto.tosId,
    source_of_funds_doc_type: dto.sourceOfFundsDocType,
    source_of_funds_doc_file: dto.sourceOfFundsDocFile,
    purpose_of_transactions: dto.purposeOfTransactions,
    purpose_of_transactions_explanation: dto.purposeOfTransactionsExplanation,
  };
}

// ─── Contas bancárias ─────────────────────────────────────────────────────────

export interface SpeiDetailsInput {
  beneficiaryName: string;
  speiProtocol?: string;
  speiClabe: string;
  speiInstitutionCode?: string;
}

export interface TransfersDetailsInput {
  transfersType: 'CVU' | 'CBU' | 'ALIAS';
  transfersAccount: string;
  beneficiaryName: string;
}

export interface AchCopDetailsInput {
  beneficiaryFirstName: string;
  beneficiaryLastName: string;
  documentType: 'CC' | 'CE' | 'NIT' | 'PASS' | 'PEP';
  documentId: string;
  email: string;
  bankCode: string;
  bankAccount: string;
  accountType: 'checking' | 'saving';
}

export interface BankAccountInput {
  pixKey?: string;
  spei?: SpeiDetailsInput;
  transfers?: TransfersDetailsInput;
  achCop?: AchCopDetailsInput;
}

/** Campos BlindPay (snake_case) da conta, menos type/name. `null` em BR. */
export type BankAccountDetails = Record<string, string>;

export interface BuiltBankAccount {
  params: CreateBankAccountParams;
  /** Só contas Pix guardam chave; nos outros rails fica null. */
  pixKey: string | null | undefined;
  details: BankAccountDetails | null;
}

const BANK_DETAILS_KEYS: readonly BankDetailsKey[] = [
  'pixKey',
  'spei',
  'transfers',
  'achCop',
];

/** Protocolos SPEI que identificam o destino pela instituição, não pela CLABE. */
const SPEI_PROTOCOLS_NEEDING_INSTITUTION = ['debitcard', 'phonenum'];

/** Regras de documento do ach_cop_bitso, conforme a doc da BlindPay. */
const ACH_COP_DOCUMENT_RULES: Record<
  AchCopDetailsInput['documentType'],
  { regex: RegExp; hint: string }
> = {
  CC: { regex: /^\d{3,10}$/, hint: 'CC deve ter de 3 a 10 dígitos.' },
  CE: { regex: /^\d{6,10}$/, hint: 'CE deve ter de 6 a 10 dígitos.' },
  NIT: { regex: /^\d{9,10}$/, hint: 'NIT deve ter 9 ou 10 dígitos.' },
  PASS: {
    regex: /^[A-Za-z0-9]{3,15}$/,
    hint: 'Passaporte deve ter de 3 a 15 letras ou dígitos.',
  },
  // Sem regra de formato documentada para PEP.
  PEP: { regex: /\S/, hint: 'Informe o número do PEP.' },
};

function invalidDetails(fields: Record<string, string>): BadRequestException {
  return railError(
    'BANK_ACCOUNT_DETAILS_INVALID',
    'Revise os dados bancários destacados.',
    fields,
  );
}

function speiDetails(spei: SpeiDetailsInput): BankAccountDetails {
  // A BlindPay usa os valores em minúsculas; 'CLABE' digitado pelo app vale o
  // mesmo que 'clabe', inclusive para a checagem dos 18 dígitos.
  const protocol = spei.speiProtocol?.trim().toLowerCase() || 'clabe';
  const clabe = spei.speiClabe?.trim() ?? '';
  const institution = spei.speiInstitutionCode?.trim();
  const fields: Record<string, string> = {};

  if (isBlank(spei.beneficiaryName)) {
    fields['spei.beneficiaryName'] = 'Informe o nome do beneficiário.';
  }
  if (!/^\d+$/.test(clabe)) {
    fields['spei.speiClabe'] = 'Use apenas dígitos.';
  } else if (protocol === 'clabe' && clabe.length !== 18) {
    fields['spei.speiClabe'] = 'A CLABE deve ter 18 dígitos.';
  }
  if (SPEI_PROTOCOLS_NEEDING_INSTITUTION.includes(protocol) && !institution) {
    fields['spei.speiInstitutionCode'] =
      'Obrigatório para este protocolo SPEI.';
  }
  if (Object.keys(fields).length > 0) throw invalidDetails(fields);

  return {
    beneficiary_name: spei.beneficiaryName.trim(),
    spei_protocol: protocol,
    spei_clabe: clabe,
    ...(institution ? { spei_institution_code: institution } : {}),
  };
}

function transfersDetails(
  transfers: TransfersDetailsInput,
): BankAccountDetails {
  const account = transfers.transfersAccount?.trim() ?? '';
  const fields: Record<string, string> = {};

  if (isBlank(transfers.beneficiaryName)) {
    fields['transfers.beneficiaryName'] = 'Informe o nome do beneficiário.';
  }
  if (transfers.transfersType === 'ALIAS') {
    if (!/^[A-Za-z0-9.-]{6,20}$/.test(account)) {
      fields['transfers.transfersAccount'] =
        'O alias deve ter de 6 a 20 caracteres (letras, dígitos, "." ou "-").';
    }
  } else if (!/^\d{22}$/.test(account)) {
    fields['transfers.transfersAccount'] =
      `O ${transfers.transfersType} deve ter 22 dígitos.`;
  }
  if (Object.keys(fields).length > 0) throw invalidDetails(fields);

  return {
    beneficiary_name: transfers.beneficiaryName.trim(),
    transfers_type: transfers.transfersType,
    transfers_account: account,
  };
}

function achCopDetails(achCop: AchCopDetailsInput): BankAccountDetails {
  const documentId = achCop.documentId?.trim() ?? '';
  const bankAccount = achCop.bankAccount?.trim() ?? '';
  const fields: Record<string, string> = {};

  const rule = ACH_COP_DOCUMENT_RULES[achCop.documentType];
  if (!rule.regex.test(documentId)) {
    fields['achCop.documentId'] = rule.hint;
  }
  if (!/^\d+$/.test(bankAccount)) {
    fields['achCop.bankAccount'] = 'Use apenas dígitos.';
  }
  if (isBlank(achCop.beneficiaryFirstName)) {
    fields['achCop.beneficiaryFirstName'] = 'Informe o nome.';
  }
  if (isBlank(achCop.beneficiaryLastName)) {
    fields['achCop.beneficiaryLastName'] = 'Informe o sobrenome.';
  }
  if (isBlank(achCop.bankCode)) {
    fields['achCop.bankCode'] = 'Informe o código do banco.';
  }
  if (Object.keys(fields).length > 0) throw invalidDetails(fields);

  return {
    ach_cop_beneficiary_first_name: achCop.beneficiaryFirstName.trim(),
    ach_cop_beneficiary_last_name: achCop.beneficiaryLastName.trim(),
    ach_cop_document_id: documentId,
    ach_cop_document_type: achCop.documentType,
    ach_cop_email: achCop.email.trim(),
    ach_cop_bank_code: achCop.bankCode.trim(),
    ach_cop_bank_account: bankAccount,
    account_type: achCop.accountType,
  };
}

/**
 * Monta a conta a partir do DTO. Exige exatamente o objeto de detalhes do rail
 * do receiver: dado de outro país nunca é enviado, nem descartado em silêncio.
 */
export function buildBankAccountParams(
  rail: RampRail,
  name: string,
  dto: BankAccountInput,
): BuiltBankAccount {
  const foreign = BANK_DETAILS_KEYS.filter(
    (key) => key !== rail.bankDetailsKey && dto[key] != null,
  );
  if (foreign.length > 0) {
    throw railError(
      'BANK_ACCOUNT_DETAILS_MISMATCH',
      `Contas de ${rail.country} usam apenas "${rail.bankDetailsKey}".`,
      Object.fromEntries(
        foreign.map((key) => [
          key,
          `Não aceito para contas de ${rail.country}.`,
        ]),
      ),
    );
  }

  // Pix segue o contrato atual: chave opcional, sem `details`.
  if (rail.bankAccountType === 'pix') {
    return {
      params: { type: 'pix', name, pix_key: dto.pixKey },
      pixKey: dto.pixKey,
      details: null,
    };
  }

  const key = rail.bankDetailsKey;
  if (dto[key] == null) {
    throw railError(
      'BANK_ACCOUNT_DETAILS_REQUIRED',
      `Informe os dados bancários em "${key}".`,
      { [key]: 'Obrigatório.' },
    );
  }

  const details =
    rail.bankAccountType === 'spei_bitso'
      ? speiDetails(dto.spei!)
      : rail.bankAccountType === 'transfers_bitso'
        ? transfersDetails(dto.transfers!)
        : achCopDetails(dto.achCop!);

  return {
    params: {
      type: rail.bankAccountType,
      name,
      ...details,
    } as CreateBankAccountParams,
    pixKey: null,
    details,
  };
}

/** Campos que o payload de cada tipo não-Pix precisa ter para ser recriado. */
const REQUIRED_DETAIL_KEYS: Record<
  Exclude<BankAccountType, 'pix'>,
  readonly string[]
> = {
  spei_bitso: ['beneficiary_name', 'spei_protocol', 'spei_clabe'],
  transfers_bitso: ['beneficiary_name', 'transfers_type', 'transfers_account'],
  ach_cop_bitso: [
    'ach_cop_beneficiary_first_name',
    'ach_cop_beneficiary_last_name',
    'ach_cop_document_id',
    'ach_cop_document_type',
    'ach_cop_email',
    'ach_cop_bank_code',
    'ach_cop_bank_account',
    'account_type',
  ],
};

/**
 * Recria o payload de uma conta salva (reenvio de KYC). Pix é sempre
 * reconstruível — chave ausente segue sem `pix_key`, como sempre foi. Nos
 * outros tipos, `null` quando `details` falta ou está incompleto.
 */
export function bankAccountParamsFromStored(
  stored: { type?: string | null; pixKey?: string | null; details?: unknown },
  name: string,
): CreateBankAccountParams | null {
  const type = stored.type ?? 'pix';
  if (type === 'pix') {
    return { type: 'pix', name, pix_key: stored.pixKey ?? undefined };
  }

  const required =
    REQUIRED_DETAIL_KEYS[type as Exclude<BankAccountType, 'pix'>];
  const details = stored.details;
  if (!required || !details || typeof details !== 'object') return null;
  if (Array.isArray(details)) return null;

  const record = details as Record<string, unknown>;
  if (required.some((key) => isBlank(record[key]))) return null;

  const clean = Object.fromEntries(
    Object.entries(record).filter(([, value]) => typeof value === 'string'),
  );
  return { ...clean, type, name } as CreateBankAccountParams;
}

// ─── Payer rules (onramp) ─────────────────────────────────────────────────────

export interface TransfersPayerInput {
  allowedTaxId: string;
}

export interface PsePayerInput {
  fullName: string;
  documentType: 'CC' | 'NIT';
  documentNumber: string;
  email: string;
  phone: string;
  bankCode: string;
}

export interface PayerRulesInput {
  transfersPayer?: TransfersPayerInput;
  psePayer?: PsePayerInput;
}

/** CUIT/CUIL, com ou sem hífens. */
const CUIT_REGEX = /^(\d{2})-?(\d{8})-?(\d)$/;

/**
 * Telefone do pagador PSE. A doc da BlindPay fala em "+57 + 9 dígitos", mas
 * celular colombiano tem 10 — aceitamos os dois e deixamos a BlindPay decidir.
 */
export const PSE_PHONE_REGEX = /^\+57\d{9,10}$/;

const PAYER_KEY_BY_KIND = {
  transfers: 'transfersPayer',
  pse: 'psePayer',
} as const;

/**
 * `payer_rules` do payin quote. Só existe para os rails que a exigem; mandar
 * regra para um rail que não usa (ou a do rail errado) é erro, não descarte.
 */
export function buildPayerRules(
  rail: RampRail,
  dto: PayerRulesInput,
): BlindPayPayerRules | undefined {
  const expected = rail.payerRules ? PAYER_KEY_BY_KIND[rail.payerRules] : null;
  const sent = (['transfersPayer', 'psePayer'] as const).filter(
    (key) => dto[key] != null,
  );
  const foreign = sent.filter((key) => key !== expected);
  if (foreign.length > 0) {
    throw railError(
      'PAYER_RULES_MISMATCH',
      expected
        ? `Pagamentos de ${rail.country} usam apenas "${expected}".`
        : `Pagamentos de ${rail.country} não usam dados de pagador.`,
      Object.fromEntries(
        foreign.map((key) => [key, `Não aceito para ${rail.country}.`]),
      ),
    );
  }
  if (!expected) return undefined;

  if (expected === 'transfersPayer') {
    const payer = dto.transfersPayer;
    if (!payer) throw payerRequired(expected);
    const match = CUIT_REGEX.exec(payer.allowedTaxId?.trim() ?? '');
    if (!match) {
      throw railError('PAYER_RULES_INVALID', 'Revise os dados do pagador.', {
        'transfersPayer.allowedTaxId': 'Use o CUIT/CUIL, ex.: 20-12345678-6.',
      });
    }
    return { transfers_allowed_tax_id: `${match[1]}-${match[2]}-${match[3]}` };
  }

  const payer = dto.psePayer;
  if (!payer) throw payerRequired(expected);
  const phone = payer.phone?.trim() ?? '';
  if (!PSE_PHONE_REGEX.test(phone)) {
    throw railError('PAYER_RULES_INVALID', 'Revise os dados do pagador.', {
      'psePayer.phone': 'Use o formato +57 seguido do número.',
    });
  }
  return {
    pse_full_name: payer.fullName.trim(),
    pse_document_type: payer.documentType,
    pse_document_number: payer.documentNumber.trim(),
    pse_email: payer.email.trim(),
    pse_phone: phone,
    pse_bank_code: payer.bankCode.trim(),
  };
}

function payerRequired(key: string): BadRequestException {
  return railError(
    'PAYER_RULES_REQUIRED',
    `Informe os dados do pagador em "${key}".`,
    { [key]: 'Obrigatório.' },
  );
}

// ─── Valor do onramp ──────────────────────────────────────────────────────────

export interface FiatAmountInput {
  amountFiat?: number;
  amountBrl?: number;
  amountUsd?: number;
}

/**
 * `usd`: alvo líquido a receber em USDC (currency_type 'receiver').
 * `fiat`: quanto o usuário paga, em unidades menores da moeda do rail
 * (currency_type 'sender').
 */
export type ResolvedFiatAmount =
  | { kind: 'usd'; amount: number }
  | { kind: 'fiat'; amount: number };

export function resolveFiatAmount(
  rail: RampRail,
  dto: FiatAmountInput,
): ResolvedFiatAmount {
  // amountUsd tem precedência, como antes do multi-rail.
  if (dto.amountUsd != null) return { kind: 'usd', amount: dto.amountUsd };

  if (dto.amountFiat != null && dto.amountBrl != null) {
    throw railError(
      'AMOUNT_AMBIGUOUS',
      'Informe amountFiat ou amountBrl, não os dois.',
      { amountBrl: 'Use apenas amountFiat.' },
    );
  }
  if (dto.amountBrl != null && rail.currency !== 'BRL') {
    throw railError(
      'AMOUNT_CURRENCY_MISMATCH',
      `amountBrl só vale para BRL. Para ${rail.currency}, use amountFiat.`,
      { amountBrl: `Use amountFiat em ${rail.currency}.` },
    );
  }

  const amount = dto.amountFiat ?? dto.amountBrl;
  if (amount == null) {
    throw railError(
      'AMOUNT_REQUIRED',
      'Informe amountFiat, amountBrl ou amountUsd',
    );
  }

  // Rejeita em vez de arredondar: cobrar valor diferente do digitado não é
  // decisão do backend.
  if (rail.wholeUnitOnly && amount % 100 !== 0) {
    const lower = Math.floor(amount / 100) * 100;
    const upper = lower + 100;
    const options = lower > 0 ? `${lower} ou ${upper}` : `${upper}`;
    throw railError(
      'AMOUNT_MUST_BE_WHOLE_UNIT',
      `Em ${rail.currency} o valor precisa ser em unidades inteiras (múltiplo de 100). Tente ${options}.`,
      { amountFiat: 'Use um múltiplo de 100.' },
    );
  }

  return { kind: 'fiat', amount };
}

// ─── Instruções de pagamento ──────────────────────────────────────────────────

export type PaymentInstructions =
  | { method: 'pix'; pixCode: string }
  | { method: 'spei'; clabe: string }
  | { method: 'transfers'; account: string; accountType: string | null }
  | { method: 'pse'; paymentLink: string };

/**
 * O que o usuário precisa para pagar, normalizado por método. `null` quando o
 * campo ainda não veio no payin (pode chegar depois — o sync preenche).
 */
export function extractPaymentInstructions(
  method: PayinMethod,
  payin: Pick<
    BlindPayPayin,
    'pix_code' | 'clabe' | 'pse_payment_link' | 'tracking_transaction'
  >,
): PaymentInstructions | null {
  switch (method) {
    case 'pix':
      return payin.pix_code ? { method: 'pix', pixCode: payin.pix_code } : null;
    case 'spei':
      return payin.clabe ? { method: 'spei', clabe: payin.clabe } : null;
    case 'transfers': {
      const instruction = payin.tracking_transaction?.transfers_instruction;
      return instruction?.account
        ? {
            method: 'transfers',
            account: instruction.account,
            accountType: instruction.type ?? null,
          }
        : null;
    }
    case 'pse': {
      const link =
        payin.pse_payment_link ??
        payin.tracking_transaction?.pse_instruction?.payment_link;
      return link ? { method: 'pse', paymentLink: link } : null;
    }
  }
}
