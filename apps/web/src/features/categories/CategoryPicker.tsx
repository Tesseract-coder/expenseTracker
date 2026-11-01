import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CategoryDto, Direction } from '@kharcha/shared';
import { useCategories } from '@/app/queries';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { buildCategoryTree, orderGroupsForDirection } from '@/lib/categories';
import { cn } from '@/lib/utils';

interface CategoryPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (category: CategoryDto) => void;
  selectedId?: string | null;
  direction?: Direction;
  /** Allow picking a whole group (used by filters). */
  allowGroups?: boolean;
  /** Hide categories, e.g. the merge source. */
  excludeIds?: string[];
  title?: string;
  nested?: boolean;
}

export function CategoryPicker({
  open,
  onOpenChange,
  onSelect,
  selectedId,
  direction = 'out',
  allowGroups = false,
  excludeIds = [],
  title = 'Choose category',
  nested = true,
}: CategoryPickerProps) {
  const categories = useCategories();
  const [query, setQuery] = useState('');

  const tree = useMemo(() => {
    const ordered = orderGroupsForDirection(buildCategoryTree(categories.data ?? []), direction);
    const q = query.trim().toLowerCase();
    return ordered
      .map((g) => ({
        ...g,
        children: g.children.filter(
          (c) =>
            !excludeIds.includes(c.id) &&
            (!q || c.name.toLowerCase().includes(q) || g.group.name.toLowerCase().includes(q)),
        ),
      }))
      .filter((g) => g.children.length > 0 || (allowGroups && !q));
  }, [categories.data, direction, query, excludeIds, allowGroups]);

  const pick = (c: CategoryDto) => {
    onSelect(c);
    onOpenChange(false);
    setQuery('');
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} nested={nested}>
      <div className="relative mb-3">
        <Search aria-hidden className="absolute top-3 left-3 size-5 text-muted-foreground" />
        <Input
          aria-label="Search categories"
          placeholder="Search categories"
          className="pl-10"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {categories.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="flex flex-col gap-4">
          {tree.map(({ group, children }) => (
            <section key={group.id} aria-label={group.name}>
              {allowGroups ? (
                <button
                  type="button"
                  onClick={() => pick(group)}
                  className={cn(
                    'mb-2 min-h-11 text-left text-sm font-semibold text-muted-foreground hover:text-foreground',
                    selectedId === group.id && 'text-primary',
                  )}
                >
                  {group.name} (all)
                </button>
              ) : (
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{group.name}</h3>
              )}
              <div className="grid grid-cols-3 gap-2">
                {children.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pick(c)}
                    aria-pressed={selectedId === c.id}
                    className={cn(
                      'flex min-h-20 flex-col items-center justify-center gap-1 rounded-lg border p-2 text-center text-xs leading-tight',
                      selectedId === c.id
                        ? 'border-primary bg-accent'
                        : 'border-border hover:bg-muted',
                    )}
                  >
                    <CategoryIcon icon={c.icon} color={c.color} className="size-8" />
                    <span className="line-clamp-2">{c.name}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {tree.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No matches</p>
          )}
        </div>
      )}
    </Sheet>
  );
}
