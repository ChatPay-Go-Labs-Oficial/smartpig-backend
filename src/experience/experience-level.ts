export const MAX_USER_LEVEL = 50;

export type ExperienceTier =
  | 'UNRANKED'
  | 'BEGINNER'
  | 'CONSISTENT'
  | 'DEDICATED'
  | 'VETERAN';

export interface ExperienceLevel {
  level: number;
  tier: ExperienceTier;
  totalXp: number;
  currentLevelXp: number;
  nextLevelXp: number | null;
  xpIntoLevel: number;
  xpToNextLevel: number | null;
}

/**
 * Product curve from PigFi Experience v1. `ceil` makes every threshold an
 * integer and agrees with the reference values in the editorial review.
 */
export function xpRequiredForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > MAX_USER_LEVEL) {
    throw new RangeError(
      `level must be an integer from 1 to ${MAX_USER_LEVEL}`,
    );
  }

  return Math.ceil(40 * level ** 1.8);
}

export function tierForLevel(level: number): ExperienceTier {
  if (level < 1) return 'UNRANKED';
  if (level <= 10) return 'BEGINNER';
  if (level <= 25) return 'CONSISTENT';
  if (level <= 40) return 'DEDICATED';
  return 'VETERAN';
}

export function calculateExperienceLevel(totalXp: number): ExperienceLevel {
  const safeXp = Math.max(0, Math.floor(totalXp));
  let level = 0;

  for (let candidate = 1; candidate <= MAX_USER_LEVEL; candidate += 1) {
    if (safeXp < xpRequiredForLevel(candidate)) break;
    level = candidate;
  }

  const currentLevelXp = level === 0 ? 0 : xpRequiredForLevel(level);
  const nextLevelXp =
    level === MAX_USER_LEVEL ? null : xpRequiredForLevel(level + 1);

  return {
    level,
    tier: tierForLevel(level),
    totalXp: safeXp,
    currentLevelXp,
    nextLevelXp,
    xpIntoLevel: safeXp - currentLevelXp,
    xpToNextLevel: nextLevelXp === null ? null : nextLevelXp - safeXp,
  };
}
