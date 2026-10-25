import { ConflictException } from '@nestjs/common';

export interface VaultEducationLockDetails {
  vaultId: string;
  currentLevel: number;
  minimumLevel: number | null;
  missingModules: string[];
  policyVersion: number | null;
}

export class VaultEducationLockedError extends ConflictException {
  constructor(details: VaultEducationLockDetails) {
    super({
      statusCode: 409,
      code: 'VAULT_EDUCATION_LOCKED',
      message: 'Complete the required learning path before depositing',
      details,
    });
  }
}
