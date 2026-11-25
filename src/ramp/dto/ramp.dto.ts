import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { RAMP_COUNTRIES } from '../ramp-rails';
import {
  PURPOSES_OF_TRANSACTIONS,
  SOURCE_OF_FUNDS_DOC_TYPES,
  type PurposeOfTransactions,
  type SourceOfFundsDocType,
} from '../../blindpay/dto/blindpay.dto';

/**
 * Código de país normalizado (trim + upper). Só mexe em string: qualquer
 * outro tipo segue cru para o @IsString recusar.
 */
const toCountryCode = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

// ─── Terms of Service ─────────────────────────────────────────────────────────

export class InitiateTosDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  /** Optional deep-link or URL to redirect after ToS acceptance (receives ?tos_id=to_...) */
  @ApiProperty({
    description: 'Optional URL to redirect after ToS acceptance',
    required: false,
    example: 'https://smartpig.app/tos-success',
  })
  @IsOptional()
  @IsUrl()
  redirectUrl?: string;
}

// ─── Receiver ─────────────────────────────────────────────────────────────────

export class CreateReceiverDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'User first name', required: false })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiProperty({ description: 'User last name', required: false })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiProperty({ description: 'Tax ID (e.g. CPF for Brazil)', required: false })
  @IsOptional()
  @IsString()
  taxId?: string;

  /**
   * ISO 3166-1 alpha-2. Define o rail do ramp (moeda, Pix/SPEI/Transfers/PSE).
   * Omitido vale BR — o app atual não envia. País fora do registry sai como
   * 400 `RAMP_COUNTRY_UNSUPPORTED` no service, não aqui.
   */
  @ApiProperty({
    description: 'País do ramp (ISO 3166-1 alpha-2)',
    enum: RAMP_COUNTRIES,
    default: 'BR',
    required: false,
  })
  @IsOptional()
  @Transform(toCountryCode)
  @IsString()
  @Length(2, 2)
  country?: string;

  @ApiProperty({ enum: ['individual', 'business'], required: false })
  @IsOptional()
  @IsEnum(['individual', 'business'])
  type?: 'individual' | 'business';

  /**
   * 'light' segue aceito por compatibilidade, mas a BlindPay sempre o recusa:
   * o service envia 'standard'. Em CO, pessoa física é sempre 'enhanced'.
   */
  @ApiProperty({
    enum: ['light', 'standard', 'enhanced'],
    required: false,
    description:
      "'light' está obsoleto e é enviado como 'standard'. CO (pessoa física) força 'enhanced'.",
  })
  @IsOptional()
  @IsEnum(['light', 'standard', 'enhanced'])
  kycType?: 'light' | 'standard' | 'enhanced';

  // ─── Standard KYC fields (required when kycType = 'standard') ───────────

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  addressLine1?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  stateProvinceRegion?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  postalCode?: string;

  /** ISO 8601 date string, e.g. '1990-01-15T00:00:00Z' */
  @ApiProperty({
    description: 'User date of birth (ISO 8601)',
    required: false,
    example: '1990-01-15T00:00:00Z',
  })
  @IsOptional()
  @IsISO8601()
  dateOfBirth?: string;

  /** ISO 3166-1 alpha-2 country code of the ID document */
  @ApiProperty({
    description: 'Country of ID document (default: país do receiver)',
    required: false,
  })
  @IsOptional()
  @Transform(toCountryCode)
  @IsString()
  idDocCountry?: string;

  @ApiProperty({ enum: ['PASSPORT', 'ID_CARD', 'DRIVERS'], required: false })
  @IsOptional()
  @IsEnum(['PASSPORT', 'ID_CARD', 'DRIVERS'])
  idDocType?: 'PASSPORT' | 'ID_CARD' | 'DRIVERS';

  /** URL of selfie image — obtain via POST /ramp/upload */
  @ApiProperty({ description: 'Hosted URL of selfie', required: false })
  @IsOptional()
  @IsUrl()
  selfieFileUrl?: string;

  /** URL of ID document front — obtain via POST /ramp/upload */
  @ApiProperty({ description: 'Hosted URL of ID front', required: false })
  @IsOptional()
  @IsUrl()
  idDocFrontUrl?: string;

  /** URL of ID document back — obtain via POST /ramp/upload */
  @ApiProperty({ description: 'Hosted URL of ID back', required: false })
  @IsOptional()
  @IsUrl()
  idDocBackUrl?: string;

  /**
   * Terms of Service acceptance ID — obtain via POST /ramp/tos flow.
   * Format: to_XXXXXXXXXXXX (exactly 15 chars)
   */
  @ApiProperty({ description: 'ToS acceptance ID', required: false })
  @IsOptional()
  @IsString()
  tosId?: string;

  // ─── Enhanced KYC (obrigatório em CO para pessoa física) ─────────────────
  // Enums conforme o SDK oficial da BlindPay (a doc pública não os lista).

  @ApiProperty({
    description: 'Tipo do comprovante de origem dos recursos (enhanced)',
    enum: SOURCE_OF_FUNDS_DOC_TYPES,
    required: false,
  })
  @IsOptional()
  @IsIn(SOURCE_OF_FUNDS_DOC_TYPES)
  sourceOfFundsDocType?: SourceOfFundsDocType;

  /** URL do comprovante — obtain via POST /ramp/upload */
  @ApiProperty({
    description: 'Hosted URL do comprovante de origem dos recursos (enhanced)',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  sourceOfFundsDocFile?: string;

  @ApiProperty({
    description: 'Finalidade das transações (enhanced)',
    enum: PURPOSES_OF_TRANSACTIONS,
    required: false,
  })
  @IsOptional()
  @IsIn(PURPOSES_OF_TRANSACTIONS)
  purposeOfTransactions?: PurposeOfTransactions;

  @ApiProperty({
    description: "Explicação da finalidade — obrigatória quando for 'other'",
    required: false,
  })
  @IsOptional()
  @IsString()
  purposeOfTransactionsExplanation?: string;
}

/**
 * Reenvio de KYC após rejeição. Mesmo payload da criação: a BlindPay não
 * permite corrigir um customer existente, então o reenvio cria um novo e
 * precisa de todos os campos de novo (o app reaproveita o rascunho salvo).
 */
export class ResubmitReceiverDto extends CreateReceiverDto {}

// ─── RFI ──────────────────────────────────────────────────────────────────────

export class SubmitRfiDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  /**
   * Objeto flat `{ [field.key]: valor }` com as chaves que o RFI pediu.
   * Fica aninhado sob `responses` porque o ValidationPipe global roda com
   * `forbidNonWhitelisted` — chaves dinâmicas no nível de cima seriam recusadas.
   */
  @ApiProperty({
    description: 'Respostas do RFI, indexadas pela key de cada campo',
    example: {
      business_description: 'Fintech de poupança',
      proof_type: 'utility_bill',
    },
  })
  @IsObject()
  responses: Record<string, unknown>;
}

// ─── Bank Account ─────────────────────────────────────────────────────────────

/** MX — conta SPEI (spei_bitso, MXN). */
export class SpeiBankDetailsDto {
  @ApiProperty({ example: 'Juan Pérez' })
  @IsString()
  @IsNotEmpty()
  beneficiaryName: string;

  /**
   * Enum não documentado pela BlindPay (valores conhecidos: clabe, debitcard,
   * phonenum). Omitido vale 'clabe'.
   */
  @ApiProperty({ required: false, default: 'clabe', example: 'clabe' })
  @IsOptional()
  @IsString()
  speiProtocol?: string;

  /** 18 dígitos quando o protocolo é 'clabe'. */
  @ApiProperty({ example: '012345678901234567' })
  @IsString()
  @Matches(/^\d+$/, { message: 'speiClabe deve conter apenas dígitos' })
  speiClabe: string;

  @ApiProperty({
    required: false,
    description: "Obrigatório quando speiProtocol é 'debitcard' ou 'phonenum'",
  })
  @IsOptional()
  @IsString()
  speiInstitutionCode?: string;
}

/** AR — conta Transfers (transfers_bitso, ARS). */
export class TransfersBankDetailsDto {
  @ApiProperty({ enum: ['CVU', 'CBU', 'ALIAS'], example: 'CVU' })
  @IsIn(['CVU', 'CBU', 'ALIAS'])
  transfersType: 'CVU' | 'CBU' | 'ALIAS';

  /** CVU/CBU: 22 dígitos. ALIAS: 6–20 caracteres (letras, dígitos, "." e "-"). */
  @ApiProperty({ example: '0000003100012345678901' })
  @IsString()
  @IsNotEmpty()
  transfersAccount: string;

  @ApiProperty({ example: 'Lucía Gómez' })
  @IsString()
  @IsNotEmpty()
  beneficiaryName: string;
}

/** CO — conta ACH (ach_cop_bitso, COP). */
export class AchCopBankDetailsDto {
  @ApiProperty({ example: 'Andrés' })
  @IsString()
  @IsNotEmpty()
  beneficiaryFirstName: string;

  @ApiProperty({ example: 'Rojas' })
  @IsString()
  @IsNotEmpty()
  beneficiaryLastName: string;

  @ApiProperty({ enum: ['CC', 'CE', 'NIT', 'PASS', 'PEP'], example: 'CC' })
  @IsIn(['CC', 'CE', 'NIT', 'PASS', 'PEP'])
  documentType: 'CC' | 'CE' | 'NIT' | 'PASS' | 'PEP';

  /** CC 3–10 dígitos · CE 6–10 · NIT 9–10 · PASS 3–15 alfanuméricos. */
  @ApiProperty({ example: '1234567890' })
  @IsString()
  @IsNotEmpty()
  documentId: string;

  @ApiProperty({ example: 'andres@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '007' })
  @IsString()
  @IsNotEmpty()
  bankCode: string;

  @ApiProperty({ example: '123456789' })
  @IsString()
  @Matches(/^\d+$/, { message: 'bankAccount deve conter apenas dígitos' })
  bankAccount: string;

  @ApiProperty({ enum: ['checking', 'saving'], example: 'saving' })
  @IsIn(['checking', 'saving'])
  accountType: 'checking' | 'saving';
}

/**
 * Envie apenas o objeto do rail do receiver: `pixKey` (BR), `spei` (MX),
 * `transfers` (AR) ou `achCop` (CO). Outro objeto → 400
 * `BANK_ACCOUNT_DETAILS_MISMATCH`; ausente → `BANK_ACCOUNT_DETAILS_REQUIRED`.
 */
export class CreateBankAccountDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  /** Display name for this bank account */
  @ApiProperty({
    description: 'Friendly name for the account',
    example: 'Main Bank Account',
  })
  @IsString()
  name: string;

  @ApiProperty({ description: 'PIX key (BR)', required: false })
  @IsOptional()
  @IsString()
  pixKey?: string;

  @ApiProperty({ type: () => SpeiBankDetailsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => SpeiBankDetailsDto)
  spei?: SpeiBankDetailsDto;

  @ApiProperty({ type: () => TransfersBankDetailsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => TransfersBankDetailsDto)
  transfers?: TransfersBankDetailsDto;

  @ApiProperty({ type: () => AchCopBankDetailsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => AchCopBankDetailsDto)
  achCop?: AchCopBankDetailsDto;
}

// ─── Blockchain Wallet ────────────────────────────────────────────────────────

export class CreateBlockchainWalletDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  /** Stellar public key (G...) — required for Stellar wallet registration */
  @ApiProperty({ description: 'Stellar public address', example: 'GB...' })
  @IsString()
  stellarAddress: string;

  /** Display name for this wallet */
  @ApiProperty({ description: 'Friendly name for the wallet', required: false })
  @IsOptional()
  @IsString()
  name?: string;
}

// ─── On-ramp ──────────────────────────────────────────────────────────────────

/** AR — quem pode pagar o payin Transfers. */
export class TransfersPayerDto {
  /** CUIT/CUIL, com ou sem hífens (normalizado para XX-XXXXXXXX-X). */
  @ApiProperty({ example: '20-12345678-6' })
  @IsString()
  @IsNotEmpty()
  allowedTaxId: string;
}

/** CO — dados do pagador PSE. */
export class PsePayerDto {
  @ApiProperty({ example: 'Andrés Rojas' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ enum: ['CC', 'NIT'], example: 'CC' })
  @IsIn(['CC', 'NIT'])
  documentType: 'CC' | 'NIT';

  @ApiProperty({ example: '1234567890' })
  @IsString()
  @IsNotEmpty()
  documentNumber: string;

  @ApiProperty({ example: 'andres@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: '+573001234567',
    description: '+57 seguido do número',
  })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: '1007' })
  @IsString()
  @IsNotEmpty()
  bankCode: string;
}

/**
 * Campos comuns a cotação e criação de onramp. Valor: informe `amountFiat`
 * (unidades menores da moeda do receiver) OU `amountUsd`; `amountBrl` segue
 * aceito para BR. Em MXN/ARS/COP o valor precisa ser múltiplo de 100.
 */
class OnrampAmountDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'BlindPay blockchain wallet ID' })
  @IsString()
  blockchainWalletId: string;

  /** Unidades menores da moeda do receiver (BRL/MXN/ARS/COP), ex.: 1000 = 10,00. */
  @ApiProperty({
    description:
      'Valor em unidades menores da moeda do receiver (centavos). MXN/ARS/COP: múltiplo de 100',
    example: 1000,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountFiat?: number;

  /**
   * Amount in BRL centavos (e.g. R$10.00 = 1000). Obsoleto: use amountFiat.
   * Só vale para receivers BR; não combine com amountFiat.
   */
  @ApiProperty({
    description: 'Amount in BRL centavos (obsoleto — use amountFiat)',
    example: 1000,
    required: false,
    deprecated: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountBrl?: number;

  /**
   * Amount in USD centavos que o usuário quer RECEBER em USDC (e.g. $10.00
   * = 1000). Tem precedência sobre os valores em fiat. Usado pelos chips de
   * valor rápido do app: o mínimo da BlindPay é em dólar, e o usuário não
   * tem como saber quanto digitar na moeda local pra bater nesse mínimo sem
   * consultar o câmbio primeiro.
   */
  @ApiProperty({
    description: 'Amount in USD centavos (valor alvo a receber em USDC)',
    example: 1000,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountUsd?: number;

  @ApiProperty({
    type: () => TransfersPayerDto,
    required: false,
    description: 'Obrigatório para receivers AR',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TransfersPayerDto)
  transfersPayer?: TransfersPayerDto;

  @ApiProperty({
    type: () => PsePayerDto,
    required: false,
    description: 'Obrigatório para receivers CO',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PsePayerDto)
  psePayer?: PsePayerDto;
}

export class OnrampQuoteDto extends OnrampAmountDto {}

export class CreateOnrampDto extends OnrampAmountDto {}

// ─── Off-ramp ─────────────────────────────────────────────────────────────────

export class OfframpQuoteDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'BlindPay bank account ID' })
  @IsString()
  bankAccountId: string;

  /** Amount in micro-USDC (1 USDC = 1_000_000) */
  @ApiProperty({ description: 'Amount in micro-USDC', example: 1000000 })
  @IsInt()
  @Min(1)
  amountUsdc: number;

  @ApiProperty({
    description: 'Whether to cover fees from the amount',
    required: false,
  })
  @IsOptional()
  coverFees?: boolean;
}

export class CreateOfframpDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'BlindPay bank account ID' })
  @IsString()
  bankAccountId: string;

  @ApiProperty({ description: 'Stellar sender address' })
  @IsString()
  senderWalletAddress: string;

  /** Amount in micro-USDC */
  @ApiProperty({ description: 'Amount in micro-USDC', example: 1000000 })
  @IsInt()
  @Min(1)
  amountUsdc: number;

  @ApiProperty({
    description: 'Whether to cover fees from the amount',
    required: false,
  })
  @IsOptional()
  coverFees?: boolean;
}

export class SubmitOfframpDto {
  @ApiProperty({ description: 'The internal user ID' })
  @IsString()
  userId: string;

  @ApiProperty({
    description: 'Signed XDR transaction from signing the delegation envelope',
  })
  @IsString()
  signedDelegationHash: string;
}
