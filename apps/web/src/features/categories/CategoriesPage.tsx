import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { CATEGORY_TYPES, type CategoryDto, type CategoryType } from '@kharcha/shared';
import { useCategories, useMergeCategory, useSaveCategory } from '@/app/queries';
import { CategoryIcon, ICON_CHOICES } from '@/components/CategoryIcon';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select, Switch } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { buildCategoryTree } from '@/lib/categories';
import { DEFAULT_COLOR, PALETTE } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CategoryPicker } from './CategoryPicker';

export const CATEGORY_TYPE_LABELS: Record<CategoryType, string> = {
  income: 'Income',
  expense_need: 'Need',
  expense_want: 'Want',
  investment: 'Investment (saving)',
  transfer: 'Transfer (excluded)',
};

type EditorState =
  | { mode: 'closed' }
  | { mode: 'edit'; category: CategoryDto }
  | { mode: 'create'; parent: CategoryDto | null };

export function CategoriesPage() {
  const categories = useCategories();
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [key, setKey] = useState(0);
  const open = (s: EditorState) => {
    setKey((k) => k + 1);
    setEditor(s);
  };
  const tree = buildCategoryTree(categories.data ?? [], showArchived);

  return (
    <div className="flex flex-col gap-4">
      <Switch label="Show archived" checked={showArchived} onCheckedChange={setShowArchived} />
      {categories.isPending && <Skeleton className="h-64 w-full" />}
      {tree.map(({ group, children }) => (
        <Card key={group.id}>
          <div className="flex items-center justify-between border-b border-border pr-2">
            <button
              type="button"
              onClick={() => open({ mode: 'edit', category: group })}
              className="flex min-h-12 min-w-0 flex-1 items-center gap-2 px-4 text-left text-sm font-semibold"
            >
              <span
                aria-hidden
                className="size-3 rounded-full"
                style={{ backgroundColor: group.color ?? '#64748b' }}
              />
              {group.name}
              <span className="text-xs font-normal text-muted-foreground">
                {CATEGORY_TYPE_LABELS[group.type]}
              </span>
              {group.archived && (
                <span className="text-xs font-normal text-muted-foreground">(archived)</span>
              )}
            </button>
            {group.slug !== 'system' && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Add category to ${group.name}`}
                onClick={() => open({ mode: 'create', parent: group })}
              >
                <Plus aria-hidden className="size-5" />
              </Button>
            )}
          </div>
          <ul className="divide-y divide-border">
            {children.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => open({ mode: 'edit', category: c })}
                  className={cn(
                    'flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm',
                    c.archived && 'opacity-50',
                  )}
                >
                  <CategoryIcon icon={c.icon} color={c.color} className="size-8" />
                  <span className="flex-1">{c.name}</span>
                  {c.type !== group.type && (
                    <span className="text-xs text-muted-foreground">
                      {CATEGORY_TYPE_LABELS[c.type]}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      <Button variant="outline" onClick={() => open({ mode: 'create', parent: null })}>
        <Plus aria-hidden className="size-4" /> Add group
      </Button>

      <Sheet
        open={editor.mode !== 'closed'}
        onOpenChange={(o) => !o && setEditor({ mode: 'closed' })}
        title={
          editor.mode === 'edit'
            ? `Edit ${editor.category.parentId ? 'category' : 'group'}`
            : editor.mode === 'create' && editor.parent
              ? `New category in ${editor.parent.name}`
              : 'New group'
        }
      >
        {editor.mode !== 'closed' && (
          <CategoryForm
            key={key}
            state={editor}
            allCategories={categories.data ?? []}
            onDone={() => setEditor({ mode: 'closed' })}
          />
        )}
      </Sheet>
    </div>
  );
}

function CategoryForm({
  state,
  allCategories,
  onDone,
}: {
  state: Exclude<EditorState, { mode: 'closed' }>;
  allCategories: CategoryDto[];
  onDone: () => void;
}) {
  const save = useSaveCategory();
  const merge = useMergeCategory();
  const existing = state.mode === 'edit' ? state.category : null;
  const parent =
    state.mode === 'create'
      ? state.parent
      : existing?.parentId
        ? (allCategories.find((c) => c.id === existing.parentId) ?? null)
        : null;
  const isGroup = existing ? existing.parentId === null : parent === null;
  const isSystem = !!existing && (existing.systemKey !== null || existing.slug === 'system');
  const groups = allCategories.filter(
    (c) => c.parentId === null && !c.archived && c.slug !== 'system',
  );

  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<CategoryType>(existing?.type ?? parent?.type ?? 'expense_need');
  const [icon, setIcon] = useState<string | null>(existing?.icon ?? (isGroup ? null : 'tag'));
  const [color, setColor] = useState<string | null>(
    existing?.color ?? parent?.color ?? DEFAULT_COLOR,
  );
  const [parentId, setParentId] = useState(existing?.parentId ?? parent?.id ?? '');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    try {
      if (existing) {
        await save.mutateAsync({
          id: existing.id,
          body: {
            name,
            icon,
            color,
            ...(isSystem ? {} : { type }),
            ...(!isGroup && !isSystem && parentId !== existing.parentId ? { parentId } : {}),
          },
        });
      } else {
        await save.mutateAsync({ body: { name, parentId: parent?.id ?? null, type, icon, color } });
      }
      toast.success('Saved');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function toggleArchive() {
    if (!existing) return;
    try {
      await save.mutateAsync({ id: existing.id, body: { archived: !existing.archived } });
      toast.success(existing.archived ? 'Restored' : 'Archived');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="Name" htmlFor="cat-name">
        <Input
          id="cat-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus={!existing}
        />
      </Field>
      {!isSystem && (
        <Field label="Counts as" htmlFor="cat-type">
          <Select
            id="cat-type"
            value={type}
            onChange={(e) => setType(e.target.value as CategoryType)}
          >
            {CATEGORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {CATEGORY_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {!isGroup && !isSystem && existing && (
        <Field label="Group" htmlFor="cat-parent">
          <Select id="cat-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {!isGroup && (
        <Field label="Icon">
          <div
            role="radiogroup"
            aria-label="Icon"
            className="grid max-h-48 grid-cols-6 gap-1 overflow-y-auto"
          >
            {ICON_CHOICES.map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={icon === i}
                aria-label={i}
                onClick={() => setIcon(i)}
                className={cn(
                  'flex min-h-11 items-center justify-center rounded-md',
                  icon === i ? 'bg-accent ring-2 ring-primary' : 'hover:bg-muted',
                )}
              >
                <CategoryIcon icon={i} color={color} className="size-8 bg-transparent" />
              </button>
            ))}
          </div>
        </Field>
      )}
      <Field label="Color">
        <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={cn(
                'size-11 rounded-full border-4',
                color === c ? 'border-foreground' : 'border-transparent',
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </Field>
      {error && (
        <p role="alert" className="text-sm text-expense">
          {error}
        </p>
      )}
      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-border bg-card px-4 pt-3 pb-1">
        <Button type="submit" disabled={save.isPending}>
          {existing ? 'Save changes' : 'Create'}
        </Button>
        {existing && !isSystem && (
          <div className={cn('grid gap-2', isGroup ? 'grid-cols-1' : 'grid-cols-2')}>
            <Button type="button" variant="outline" onClick={() => void toggleArchive()}>
              {existing.archived ? 'Restore' : 'Archive'}
            </Button>
            {!isGroup && (
              <Button type="button" variant="outline" onClick={() => setMergeOpen(true)}>
                Merge into…
              </Button>
            )}
          </div>
        )}
      </div>
      {existing && (
        <CategoryPicker
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          excludeIds={[existing.id]}
          title={`Merge “${existing.name}” into`}
          onSelect={(target) => {
            merge.mutate(
              { source: existing, target },
              {
                onSuccess: ({ moved }) => {
                  toast.success(
                    `Merged into ${target.name}: ${moved.transactions + moved.splits} transactions moved`,
                  );
                  onDone();
                },
                onError: (e) => toast.error(errorMessage(e)),
              },
            );
          }}
        />
      )}
    </form>
  );
}
