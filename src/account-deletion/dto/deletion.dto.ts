import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class RequestDeletionDto {
  /** Makes a retried request return the existing one instead of creating another. */
  @IsUUID('4')
  idempotencyKey!: string;
}

/**
 * The three acknowledgements, each mapping to one block of the consent screen.
 *
 * They are separate and all required — a single "I agree" would not evidence that
 * the user was told what is kept and what cannot be erased. `Equals(true)` rejects
 * `false` as well as absence, so an unticked box is a 400 and never a silent pass.
 */
export class AcknowledgementsDto {
  @IsBoolean()
  @Equals(true)
  dataRetention!: boolean;

  @IsBoolean()
  @Equals(true)
  onchainHistoryPublic!: boolean;

  @IsBoolean()
  @Equals(true)
  irreversible!: boolean;
}

export class ConfirmDeletionDto {
  /** Absent when the wallet was never activated — there is nothing to close. */
  @IsOptional()
  @IsString()
  signedXdr?: string;

  @ValidateNested()
  @Type(() => AcknowledgementsDto)
  acknowledgements!: AcknowledgementsDto;
}

export interface RequestDeletionResult {
  requestId: string;
  closureXdr: string | null;
  residuals: {
    sweptToTreasuryUsd: string;
    permanentlyLostUsd: string;
  };
  expiresAt: string;
}

export interface ConfirmDeletionResult {
  status: string;
  deletedAt: string;
}
