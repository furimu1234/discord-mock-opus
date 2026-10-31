export const XP_PER_MESSAGE = 15;
export const COOLDOWN_SECONDS = 60;
export const LEADERBOARD_SIZE = 10;

const XP_FACTOR = 100;

/** レベル n に必要な累計 XP。レベル 1 は 100、レベル 2 は 400、レベル 3 は 900。 */
export function xpForLevel(level: number): number {
  return XP_FACTOR * level * level;
}

export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(xp / XP_FACTOR));
}
