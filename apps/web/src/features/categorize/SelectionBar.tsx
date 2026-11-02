import { Tags, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Direction } from '@kharcha/shared';
import { useBulkCategorize, useCategoryMap } from '@/app/queries';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { CategoryPicker } from '@/features/categories/CategoryPicker';
import { useUndoToast } from './LabelSheet';

/** Sticky multi-select action bar: "N selected · Categorize". */
export function SelectionBar({
  ids,
  direction,
  onCancel,
  onDone,
}: {
  ids: string[];
  direction: Direction;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const bulk = useBulkCategorize();
  const showUndo = useUndoToast();
  const { byId } = useCategoryMap();

  return (
    <div className="sticky bottom-20 z-10 -mx-4 flex items-center gap-2 border-t border-border bg-background px-4 pt-3 pb-2">
      <Button variant="ghost" size="icon" aria-label="Cancel selection" onClick={onCancel}>
        <X aria-hidden className="size-5" />
      </Button>
      <span className="flex-1 text-sm font-medium" aria-live="polite">
        {ids.length} selected
      </span>
      <Button disabled={ids.length === 0 || bulk.isPending} onClick={() => setPickerOpen(true)}>
        <Tags aria-hidden className="size-4" /> Categorize
      </Button>
      <CategoryPicker
        nested={false}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        direction={direction}
        title={`Categorize ${ids.length} transaction${ids.length === 1 ? '' : 's'}`}
        onSelect={(c) =>
          bulk.mutate(
            { ids, categoryId: c.id },
            {
              onSuccess: (r) => {
                const skipped = r.skipped ? ` (${r.skipped} skipped)` : '';
                showUndo(
                  `${r.updated} categorized as ${byId.get(c.id)?.name ?? c.name}${skipped}`,
                  r.undoToken,
                );
                onDone();
              },
              onError: (e) => toast.error(errorMessage(e)),
            },
          )
        }
      />
    </div>
  );
}
