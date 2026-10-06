import { Injectable } from '@nestjs/common';
import { DisclosureService } from './disclosure.service';
import {
  DisclosureMissingError,
  DisclosureNotAcknowledgedError,
} from './vault-registry.errors';

/**
 * The enforcement point for "no first deposit before the risk disclosure is
 * acknowledged".
 *
 * Separate from `DisclosureService` so the rule has one caller-facing entry point
 * and the read/write service stays free of HTTP concerns. It is invoked from
 * `DepositsService.createDeposit` before the intent row is created — nothing is
 * persisted, and no XDR is generated, for a deposit the user is not allowed to make.
 */
@Injectable()
export class DisclosureGuardService {
  constructor(private readonly disclosures: DisclosureService) {}

  /**
   * Throws unless this user has accepted the vault's current disclosure version.
   *
   * Fails closed when no disclosure is published at all: a vault we cannot describe
   * the risks of is a vault nobody should be depositing into. The admin route
   * refuses to activate such a vault for the same reason, so this is the second of
   * two independent checks rather than the only one.
   */
  async assertAcknowledged(userId: string, vaultId: string): Promise<void> {
    const { acknowledged, current } =
      await this.disclosures.hasAcknowledgedCurrent(userId, vaultId);

    if (!current) throw new DisclosureMissingError(vaultId);
    if (acknowledged) return;

    throw new DisclosureNotAcknowledgedError(
      vaultId,
      current.version,
      current.risks,
    );
  }
}
