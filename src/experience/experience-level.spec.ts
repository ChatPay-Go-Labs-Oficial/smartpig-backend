import {
  calculateExperienceLevel,
  tierForLevel,
  xpRequiredForLevel,
} from './experience-level';

describe('PigFi Experience level curve', () => {
  it('matches the approved reference thresholds', () => {
    expect(xpRequiredForLevel(1)).toBe(40);
    expect(xpRequiredForLevel(2)).toBe(139);
    expect(xpRequiredForLevel(4)).toBe(485);
    expect(xpRequiredForLevel(5)).toBe(725);
    expect(xpRequiredForLevel(10)).toBe(2524);
    expect(xpRequiredForLevel(50)).toBe(45731);
  });

  it('keeps a new user unranked until the first threshold', () => {
    expect(calculateExperienceLevel(39)).toMatchObject({
      level: 0,
      tier: 'UNRANKED',
      xpToNextLevel: 1,
    });
    expect(calculateExperienceLevel(40)).toMatchObject({
      level: 1,
      tier: 'BEGINNER',
    });
  });

  it('caps the displayed level at 50 without discarding excess XP', () => {
    expect(calculateExperienceLevel(100_000)).toMatchObject({
      level: 50,
      totalXp: 100_000,
      nextLevelXp: null,
      xpToNextLevel: null,
    });
  });

  it('uses the approved tier boundaries', () => {
    expect(tierForLevel(10)).toBe('BEGINNER');
    expect(tierForLevel(11)).toBe('CONSISTENT');
    expect(tierForLevel(26)).toBe('DEDICATED');
    expect(tierForLevel(41)).toBe('VETERAN');
  });
});
