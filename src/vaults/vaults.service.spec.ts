import { VaultsService } from './vaults.service';

function createService(options: {
  educationEnforced: boolean;
  disclosureEnforced: boolean;
  eligible: boolean;
  mode?: 'LITE' | 'PRO';
  acknowledgmentRequired?: boolean;
}) {
  const vault = {
    id: 'vault-eurc',
    defindexVaultId: 'CVAULT',
    assetSymbol: 'EURC',
    depositsEnabled: true,
    disclosure: {
      acknowledgmentRequired: options.acknowledgmentRequired ?? false,
    },
  };
  const registry = {
    listForUser: jest.fn().mockResolvedValue([vault]),
  };
  const config = {
    get: jest.fn((key: string, fallback: boolean) => {
      if (key === 'ENFORCE_VAULT_EDUCATION') {
        return options.educationEnforced;
      }
      if (key === 'ENFORCE_VAULT_DISCLOSURE') {
        return options.disclosureEnforced;
      }
      return fallback;
    }),
  };
  const eligibility = {
    getEligibility: jest.fn().mockResolvedValue({
      eligible: options.eligible,
      mode: options.mode ?? 'LITE',
      source: options.mode === 'PRO' ? 'PRO_BYPASS' : 'POLICY',
      vaultId: vault.id,
      currentLevel: 2,
      minimumLevel: 5,
      missingModules: ['M3'],
      policyVersion: 1,
    }),
  };

  return new VaultsService(
    {} as never,
    {} as never,
    {} as never,
    config as never,
    registry as never,
    {} as never,
    eligibility as never,
  );
}

describe('VaultsService access projection', () => {
  it('reports a Lite vault as locked when education enforcement is enabled', async () => {
    const service = createService({
      educationEnforced: true,
      disclosureEnforced: true,
      eligible: false,
    });

    await expect(service.listVaults('user-1')).resolves.toEqual([
      expect.objectContaining({
        access: expect.objectContaining({
          experienceMode: 'LITE',
          educationRequired: true,
          educationUnlocked: false,
          missingModules: ['M3'],
          canDeposit: false,
        }),
      }),
    ]);
  });

  it('keeps the Pro education bypass while disclosure remains independent', async () => {
    const service = createService({
      educationEnforced: true,
      disclosureEnforced: true,
      eligible: true,
      mode: 'PRO',
      acknowledgmentRequired: true,
    });

    await expect(service.listVaults('user-1')).resolves.toEqual([
      expect.objectContaining({
        access: expect.objectContaining({
          experienceMode: 'PRO',
          educationRequired: false,
          educationUnlocked: true,
          disclosureAcknowledged: false,
          canDeposit: false,
        }),
      }),
    ]);
  });

  it('exposes education status without blocking during rollout', async () => {
    const service = createService({
      educationEnforced: false,
      disclosureEnforced: false,
      eligible: false,
    });

    await expect(service.listVaults('user-1')).resolves.toEqual([
      expect.objectContaining({
        access: expect.objectContaining({
          educationUnlocked: false,
          educationEnforced: false,
          canDeposit: true,
        }),
      }),
    ]);
  });
});
