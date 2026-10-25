import type { ExperienceTier } from './experience-level';

export interface ExperienceReward {
  level: number;
  code: string;
  tier: Exclude<ExperienceTier, 'UNRANKED'>;
}

export const TIER_REWARDS: readonly ExperienceReward[] = [
  { level: 10, code: 'BEGINNER_BADGE_AND_FRAME', tier: 'BEGINNER' },
  { level: 25, code: 'CONSISTENT_NAME_BADGE', tier: 'CONSISTENT' },
  { level: 40, code: 'DEDICATED_PIG_VARIANTS', tier: 'DEDICATED' },
  { level: 50, code: 'VETERAN_EXCLUSIVE_SKIN', tier: 'VETERAN' },
] as const;

export function rewardsForLevel(level: number): ExperienceReward[] {
  return TIER_REWARDS.filter((reward) => reward.level <= level).map(
    (reward) => ({ ...reward }),
  );
}
