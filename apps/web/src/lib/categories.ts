import type { CategoryDto, Direction } from '@kharcha/shared';

export interface CategoryGroup {
  group: CategoryDto;
  children: CategoryDto[];
}

/** Groups with their children, in sort order. Archived entries excluded unless requested. */
export function buildCategoryTree(
  categories: CategoryDto[],
  includeArchived = false,
): CategoryGroup[] {
  const visible = categories.filter((c) => includeArchived || !c.archived);
  const groups = visible.filter((c) => c.parentId === null);
  return groups.map((group) => ({
    group,
    children: visible.filter((c) => c.parentId === group.id),
  }));
}

/** Picker order: Income first for money in, last for money out; System always last. */
export function orderGroupsForDirection(
  tree: CategoryGroup[],
  direction: Direction,
): CategoryGroup[] {
  const rank = (g: CategoryGroup) => {
    if (g.group.slug === 'system') return 3;
    if (g.group.type === 'income') return direction === 'in' ? 0 : 2;
    return 1;
  };
  return [...tree].sort((a, b) => rank(a) - rank(b));
}

export function categoryLabel(byId: Map<string, CategoryDto>, id: string | null): string {
  if (!id) return 'Uncategorized';
  const c = byId.get(id);
  if (!c) return 'Unknown';
  const parent = c.parentId ? byId.get(c.parentId) : undefined;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}
