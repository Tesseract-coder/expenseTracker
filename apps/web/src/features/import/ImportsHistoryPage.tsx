import { Download, FileUp, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { ImportDto } from '@kharcha/shared';
import { useAccounts, useImports, useRevertImport } from '@/app/queries';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<ImportDto['status'], string> = {
  uploaded: 'Not finished',
  previewed: 'Not finished',
  committing: 'Importing',
  committed: 'Imported',
  failed: 'Failed',
  reverted: 'Reverted',
};

export function ImportsHistoryPage() {
  const imports = useImports();
  const accounts = useAccounts();
  const revert = useRevertImport();
  const [confirming, setConfirming] = useState<ImportDto | null>(null);
  const accountName = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a.name])),
    [accounts.data],
  );

  if (imports.isPending) return <Skeleton className="h-40 w-full" />;
  const list = imports.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <Link
        to="/import"
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
      >
        <FileUp aria-hidden className="size-4" /> Import a statement
      </Link>
      {list.length === 0 ? (
        <EmptyState icon={FileUp} title="No imports yet" />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {list.map((i) => (
              <li key={i.id} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">
                    {i.fileName ?? 'Statement'}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs',
                      i.status === 'committed'
                        ? 'bg-accent text-accent-foreground'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {STATUS_LABEL[i.status]}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {accountName.get(i.accountId) ?? 'Account'} · {i.statementFrom ?? '?'} →{' '}
                  {i.statementTo ?? '?'} · {new Date(i.createdAt).toLocaleDateString('en-IN')}
                </p>
                {i.status === 'committed' && (
                  <p className="text-xs">
                    {i.rowsNew} new · {i.rowsDuplicate} duplicates skipped
                    {i.rowsFailed > 0 && ` · ${i.rowsFailed} unreadable`}
                  </p>
                )}
                <div className="mt-1 flex gap-2">
                  {i.status === 'committed' && (
                    <Link
                      to={`/transactions?importId=${i.id}`}
                      className="inline-flex min-h-11 items-center text-sm text-primary"
                    >
                      View
                    </Link>
                  )}
                  {i.source === 'file' && (
                    <a
                      href={`/api/imports/${i.id}/file`}
                      className="inline-flex min-h-11 items-center gap-1 text-sm text-primary"
                      download
                    >
                      <Download aria-hidden className="size-4" /> Original
                    </a>
                  )}
                  {i.status === 'committed' && (
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center gap-1 text-sm text-expense"
                      onClick={() => setConfirming(i)}
                    >
                      <Undo2 aria-hidden className="size-4" /> Revert
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Sheet
        open={!!confirming}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Revert this import?"
      >
        <p className="mb-4 text-sm text-muted-foreground">
          This deletes the {confirming?.rowsNew ?? 0} transactions it added. Transfers it linked go
          back to Uncategorized. The original file is kept, so you can import it again.
        </p>
        <Button
          className="w-full bg-expense text-white hover:bg-expense/90"
          disabled={revert.isPending}
          onClick={() => {
            if (!confirming) return;
            revert.mutate(confirming.id, {
              onSuccess: ({ deleted }) => {
                toast.success(`Removed ${deleted} transactions`);
                setConfirming(null);
              },
              onError: (e) => toast.error(errorMessage(e)),
            });
          }}
        >
          Revert import
        </Button>
      </Sheet>
    </div>
  );
}
