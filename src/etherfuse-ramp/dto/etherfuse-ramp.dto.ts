import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
  IsArray,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Onboarding ───────────────────────────────────────────────────────────────

export class UserIdDto {
  @ApiProperty({ description: 'Internal SmartPig user ID' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class CreateEtherfuseCustomerDto {
  @ApiProperty({ description: 'Internal SmartPig user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'Optional display name for the Etherfuse org', required: false })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ description: 'User email', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ description: 'User first name', required: false })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiProperty({ description: 'User last name', required: false })
  @IsOptional()
  @IsString()
  lastName?: string;
}

export class AddressDto {
  @ApiProperty() @IsString() street: string;
  @ApiProperty() @IsString() city: string;
  @ApiProperty() @IsString() region: string;
  @ApiProperty() @IsString() postalCode: string;
  @ApiProperty() @IsString() country: string;
}

export class NameDto {
  @ApiProperty() @IsString() givenName: string;
  @ApiProperty() @IsString() familyName: string;
}

export class IdNumberDto {
  @ApiProperty({ enum: ['CPF', 'CURP', 'RFC'] })
  @IsIn(['CPF', 'CURP', 'RFC'])
  type: 'CPF' | 'CURP' | 'RFC';

  @ApiProperty()
  @IsString()
  value: string;
}

export class SubmitKycDto {
  @ApiProperty({ description: 'Internal SmartPig user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: "Customer's Stellar wallet public key" })
  @IsString()
  pubkey: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  phoneNumber: string;

  @ApiProperty({ type: NameDto })
  @ValidateNested()
  @Type(() => NameDto)
  name: NameDto;

  @ApiProperty({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  address: AddressDto;

  @ApiProperty({ description: "Customer's occupation" })
  @IsString()
  occupation: string;

  @ApiProperty({ description: 'Date of birth (YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsISO8601()
  dateOfBirth?: string;

  @ApiProperty({ type: [IdNumberDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IdNumberDto)
  idNumbers?: IdNumberDto[];
}

export class UploadKycDocumentDto {
  @ApiProperty({ description: 'Internal SmartPig user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: "Customer's Stellar wallet public key" })
  @IsString()
  pubkey: string;

  @ApiProperty({ enum: ['selfie', 'id_front', 'id_back'] })
  @IsIn(['selfie', 'id_front', 'id_back'])
  documentType: 'selfie' | 'id_front' | 'id_back';
}

export class GetKycStatusDto {
  @ApiProperty({ description: 'Internal SmartPig user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: "Customer's Stellar wallet public key" })
  @IsString()
  pubkey: string;
}

export class AcceptAgreementDto {
  @ApiProperty({ description: 'Internal SmartPig user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'Presigned URL obtained from POST /etherfuse/onboarding/presigned-url' })
  @IsString()
  presignedUrl: string;
}

export class GeneratePresignedUrlDto {
  @ApiProperty({ description: 'Internal SmartPig user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: "Customer's Stellar wallet public key" })
  @IsString()
  pubkey: string;
}

export class CreatePixBankAccountDto {
  @ApiProperty({ description: 'Internal SmartPig user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'Presigned URL from POST /etherfuse/onboarding/presigned-url' })
  @IsString()
  presignedUrl: string;

  @ApiProperty({ description: 'PIX key (CPF, CNPJ, email, phone or EVP UUID)' })
  @IsString()
  pixKey: string;

  @ApiProperty({ enum: ['evp', 'cpf', 'cnpj', 'email', 'phone'] })
  @IsIn(['evp', 'cpf', 'cnpj', 'email', 'phone'])
  pixKeyType: 'evp' | 'cpf' | 'cnpj' | 'email' | 'phone';

  @ApiProperty({ description: 'Account holder first name' })
  @IsString()
  firstName: string;

  @ApiProperty({ description: 'Account holder last name' })
  @IsString()
  lastName: string;

  @ApiProperty({ description: '11-digit Brazilian CPF (tax ID)' })
  @IsString()
  cpf: string;
}

// Personal account variant
export class CreatePersonalBankAccountDto {
  @ApiProperty({ description: 'Internal SmartPig user ID' })
  @IsString()
  userId: string;

  @ApiProperty()
  @IsString()
  transactionId: string;

  @ApiProperty()
  @IsString()
  firstName: string;

  @ApiProperty()
  @IsString()
  paternalLastName: string;

  @ApiProperty()
  @IsString()
  maternalLastName: string;

  @ApiProperty({ description: 'Format: YYYYMMDD' })
  @IsString()
  birthDate: string;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2 code (e.g. MX)' })
  @IsString()
  birthCountryIsoCode: string;

  @ApiProperty({ description: '18-character CURP' })
  @IsString()
  curp: string;

  @ApiProperty({ description: '13-character RFC' })
  @IsString()
  rfc: string;

  @ApiProperty({ description: '18-digit CLABE' })
  @IsString()
  clabe: string;
}

// ─── Quotes ───────────────────────────────────────────────────────────────────

export class GetEtherfuseQuoteDto {
  @ApiProperty({ description: 'Internal SmartPig user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ enum: ['onramp', 'offramp'] })
  @IsIn(['onramp', 'offramp'])
  direction: 'onramp' | 'offramp';

  @ApiProperty({ description: 'Source asset (fiat code for onramp, e.g. MXN; crypto identifier for offramp)' })
  @IsString()
  sourceAsset: string;

  @ApiProperty({ description: 'Target asset (crypto identifier for onramp; fiat code for offramp, e.g. MXN)' })
  @IsString()
  targetAsset: string;

  @ApiProperty({ description: 'Amount of source asset' })
  @IsString()
  sourceAmount: string;

  @ApiProperty({ description: "Customer's Stellar wallet address", required: false })
  @IsOptional()
  @IsString()
  walletAddress?: string;
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export class CreateEtherfuseOnrampDto {
  @ApiProperty({ description: 'Internal SmartPig user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'EtherfuseBankAccount.id (internal)' })
  @IsString()
  bankAccountId: string;

  @ApiProperty({ description: 'Quote ID from POST /etherfuse/quote' })
  @IsString()
  quoteId: string;

  @ApiProperty({ description: "Customer's Stellar wallet public key" })
  @IsString()
  walletAddress: string;

  @ApiProperty({ description: 'Source asset identifier' })
  @IsString()
  sourceAsset: string;

  @ApiProperty({ description: 'Target asset identifier' })
  @IsString()
  targetAsset: string;

  @ApiProperty({ description: 'Source amount' })
  @IsString()
  sourceAmount: string;

  @ApiProperty({ description: 'Destination amount from quote' })
  @IsString()
  destinationAmount: string;
}

export class CreateEtherfuseOfframpDto {
  @ApiProperty({ description: 'Internal SmartPig user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'EtherfuseBankAccount.id (internal)' })
  @IsString()
  bankAccountId: string;

  @ApiProperty({ description: 'Quote ID from POST /etherfuse/quote' })
  @IsString()
  quoteId: string;

  @ApiProperty({ description: "Customer's Stellar wallet public key" })
  @IsString()
  walletAddress: string;

  @ApiProperty({ description: 'Source asset identifier (crypto)' })
  @IsString()
  sourceAsset: string;

  @ApiProperty({ description: 'Target asset identifier (fiat code)' })
  @IsString()
  targetAsset: string;

  @ApiProperty({ description: 'Source amount' })
  @IsString()
  sourceAmount: string;

  @ApiProperty({ description: 'Destination amount from quote' })
  @IsString()
  destinationAmount: string;
}

export class SubmitEtherfuseOfframpDto {
  @ApiProperty({ description: 'Signed Stellar burn transaction XDR' })
  @IsString()
  @IsNotEmpty()
  signedBurnXdr: string;
}
