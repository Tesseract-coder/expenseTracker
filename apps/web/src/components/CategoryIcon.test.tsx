import { describe, expect, it } from 'vitest';
import { flattenCategorySeed } from '@kharcha/shared';
import { CATEGORY_ICONS } from './CategoryIcon';

describe('CATEGORY_ICONS', () => {
  it('covers every seeded category icon', () => {
    const missing = flattenCategorySeed()
      .map((c) => c.icon)
      .filter((icon) => !CATEGORY_ICONS[icon]);
    expect(missing).toEqual([]);
  });
});
