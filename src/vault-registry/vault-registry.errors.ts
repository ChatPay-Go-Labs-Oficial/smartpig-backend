import { ConflictException, NotFoundException } from '@nestjs/common';
import type { RiskEntry } from './types/risk-codes';

export const VAULT_NOT_FOUND = 'VAULT_NOT_FOUND';
export const VAULT_DEPOSITS_PAUSED = 'VAULT_DEPOSITS_PAUSED';
export const DISCLOSURE_NOT_ACKNOWLEDGED = 'DISCLOSURE_NOT_ACKNOWLEDGED';
export const DISCLOSURE_MISSING = 'VAULT_DISCLOSURE_MISSING';
export const DISCLOSURE_VERSION_STALE = 'DISCLOSURE_VERSION_STALE';

export class VaultNotFoundError extends NotFoundException {
  constructor(vaultId: string) {
    super({ message: `Vault ${vaultId} not found`, code: VAULT_NOT_FOUND });
  }
}

export class VaultDepositsPausedError extends ConflictException {
  constructor(vaultId: string) {
    super({
      message: `Vault ${vaultId} is not accepting deposits right now`,
      code: VAULT_DEPOSITS_PAUSED,
      details: { vaultId },
    });
  }
}

/**
 * The first deposit into a vault whose current disclosure the user has not accepted.
 *
 * 409 rather than 403: the request is well formed and the caller is authorized —
 * what conflicts is the state of the resource, and it is fixable and retryable.
 * That is how 409 is already used here ("already activated", "already confirmed").
 * A 403 would read as "never allowed".
 *
 * Carries the risks to display, so the app can open the disclosure sheet straight
 * from the rejection instead of making a second round trip.
 */
export class DisclosureNotAcknowledgedError extends ConflictException {
  constructor(vaultId: string, version: number, risks: RiskEntry[]) {
    super({
      message: `The risk disclosure for vault ${vaultId} (v${version}) must be acknowledged before the first deposit`,
      code: DISCLOSURE_NOT_ACKNOWLEDGED,
      details: { vaultId, version, risks },
    });
  }
}

/** A vault with no published disclosure cannot be deposited into, or activated. */
export class DisclosureMissingError extends ConflictException {
  constructor(vaultId: string) {
    super({
      message: `Vault ${vaultId} has no published risk disclosure`,
      code: DISCLOSURE_MISSING,
      details: { vaultId },
    });
  }
}

/** The user acknowledged a version that is no longer the current one. */
export class DisclosureVersionStaleError extends ConflictException {
  constructor(vaultId: string, submitted: number, current: number) {
    super({
      message: `Disclosure v${submitted} is no longer current for vault ${vaultId} (now v${current})`,
      code: DISCLOSURE_VERSION_STALE,
      details: {
        vaultId,
        submittedVersion: submitted,
        currentVersion: current,
      },
    });
  }
}
