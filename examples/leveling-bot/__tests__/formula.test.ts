import { describe, expect, test } from '@dismock/test';
import { levelForXp, xpForLevel } from '../src/levels.ts';

describe('レベルの計算式', () => {
  test.each([
    [0, 0],
    [99, 0],
    [100, 1],
    [399, 1],
    [400, 2],
    [900, 3],
    [10000, 10],
  ] as const)('XP からレベルを求める %s', ([xp, level]) => {
    expect(levelForXp(xp)).toBe(level);
  });

  test('必要 XP とレベルは対応する', () => {
    for (let level = 0; level <= 100; level += 1) {
      expect(levelForXp(xpForLevel(level))).toBe(level);
      if (level > 0) expect(levelForXp(xpForLevel(level) - 1)).toBe(level - 1);
    }
  });
});
