import { ConflictException } from '@nestjs/common';
import { DisclosureGuardService } from './disclosure.guard.service';

const RISKS = [{ code: 'SMART_CONTRACT' as const, severity: 'HIGH' as const }];

function createGuard(
  result: {
    acknowledged: boolean;
    current: { version: number; risks: typeof RISKS } | null;
  },
  enforcementEnabled = true,
) {
  const disclosures = {
    hasAcknowledgedCurrent: jest.fn().mockResolvedValue(result),
  };
  const config = {
    get: jest.fn().mockReturnValue(enforcementEnabled),
  };
  return {
    guard: new DisclosureGuardService(
      disclosures as unknown as never,
      config as unknown as never,
    ),
    disclosures,
    config,
  };
}

describe('DisclosureGuardService', () => {
  it('does not block legacy clients while enforcement is disabled', async () => {
    const { guard, disclosures } = createGuard(
      { acknowledged: false, current: null },
      false,
    );

    await expect(
      guard.assertAcknowledged('user-1', 'vault-1'),
    ).resolves.toBeUndefined();
    expect(disclosures.hasAcknowledgedCurrent).not.toHaveBeenCalled();
  });

  it('passes when the user accepted the current version', async () => {
    const { guard } = createGuard({
      acknowledged: true,
      current: { version: 2, risks: RISKS },
    });

    await expect(
      guard.assertAcknowledged('user-1', 'vault-1'),
    ).resolves.toBeUndefined();
  });

  it('rejects with the version and the risks to display', async () => {
    const { guard } = createGuard({
      acknowledged: false,
      current: { version: 3, risks: RISKS },
    });

    const error = await guard
      .assertAcknowledged('user-1', 'vault-1')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    const body = (error as ConflictException).getResponse() as {
      code: string;
      details: { vaultId: string; version: number; risks: unknown };
    };
    expect(body.code).toBe('DISCLOSURE_NOT_ACKNOWLEDGED');
    expect(body.details).toEqual({
      vaultId: 'vault-1',
      version: 3,
      risks: RISKS,
    });
  });

  it('fails closed when no disclosure is published', async () => {
    // A vault whose risks we cannot describe is a vault nobody should deposit into.
    const { guard } = createGuard({ acknowledged: false, current: null });

    const error = await guard
      .assertAcknowledged('user-1', 'vault-1')
      .catch((e: unknown) => e);

    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'VAULT_DISCLOSURE_MISSING',
    });
  });

  it('asks about the user and vault it was given', async () => {
    const { guard, disclosures } = createGuard({
      acknowledged: true,
      current: { version: 1, risks: RISKS },
    });

    await guard.assertAcknowledged('user-7', 'vault-9');

    expect(disclosures.hasAcknowledgedCurrent).toHaveBeenCalledWith(
      'user-7',
      'vault-9',
    );
  });
});
