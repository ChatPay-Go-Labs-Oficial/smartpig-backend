import {
  DEFAULT_RAMP_COUNTRY,
  RAMP_COUNTRIES,
  RAMP_RAILS,
  findRailForBankAccountType,
  findRampRail,
  isRampCountry,
} from './ramp-rails';

describe('ramp-rails', () => {
  it('cobre exatamente BR, MX, AR e CO', () => {
    expect(RAMP_COUNTRIES.sort()).toEqual(['AR', 'BR', 'CO', 'MX']);
    expect(DEFAULT_RAMP_COUNTRY).toBe('BR');
  });

  it.each([
    ['BR', 'BRL', 'pix', 'pix', 'pixKey', null, false],
    ['MX', 'MXN', 'spei', 'spei_bitso', 'spei', null, true],
    [
      'AR',
      'ARS',
      'transfers',
      'transfers_bitso',
      'transfers',
      'transfers',
      true,
    ],
    ['CO', 'COP', 'pse', 'ach_cop_bitso', 'achCop', 'pse', true],
  ] as const)(
    '%s → %s / %s / %s',
    (country, currency, payin, account, detailsKey, payerRules, wholeUnit) => {
      const rail = RAMP_RAILS[country];
      expect(rail).toMatchObject({
        country,
        currency,
        payinMethod: payin,
        bankAccountType: account,
        bankDetailsKey: detailsKey,
        payerRules,
        wholeUnitOnly: wholeUnit,
      });
    },
  );

  it('só CO exige enhanced para pessoa física e recusa DRIVERS', () => {
    expect(RAMP_RAILS.CO.kyc).toEqual({
      individualRequiresEnhanced: true,
      disallowedIdDocTypes: ['DRIVERS'],
    });
    for (const country of ['BR', 'MX', 'AR'] as const) {
      expect(RAMP_RAILS[country].kyc.individualRequiresEnhanced).toBe(false);
      expect(RAMP_RAILS[country].kyc.disallowedIdDocTypes).toEqual([]);
    }
  });

  it('isRampCountry não aceita chaves herdadas nem minúsculas', () => {
    expect(isRampCountry('MX')).toBe(true);
    expect(isRampCountry('mx')).toBe(false);
    expect(isRampCountry('toString')).toBe(false);
    expect(isRampCountry(undefined)).toBe(false);
  });

  it('findRampRail normaliza trim/upper e devolve null fora do registry', () => {
    expect(findRampRail(' co ')?.country).toBe('CO');
    expect(findRampRail('CL')).toBeNull();
  });

  it('findRailForBankAccountType acha o rail pelo tipo da conta', () => {
    expect(findRailForBankAccountType('spei_bitso')?.country).toBe('MX');
    expect(findRailForBankAccountType('pix')?.country).toBe('BR');
    expect(findRailForBankAccountType('wire')).toBeNull();
  });
});
