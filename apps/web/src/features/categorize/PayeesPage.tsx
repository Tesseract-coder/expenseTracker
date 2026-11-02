import { Search, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { CounterpartyDto } from '@kharcha/shared';
import { useCounterparties, useMergeCounterparty, useRenameCounterparty } from '@/app/queries';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';

/** Payees (counterparties): rename, and merge duplicates such as a UPI ID and a card descriptor. */
export function PayeesPage() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  const list = useCounterparties(debounced, 100);
  const [editing, setEditing] = useState<CounterpartyDto | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search aria-hidden className="absolute top-3 left-3 size-5 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search payees"
          placeholder="Search payees or UPI IDs"
          className="pl-10"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {list.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState icon={Users} title={debounced ? 'No matching payees' : 'No payees yet'}>
          Payees are created from imported statements and the “Paid to” field.
        </EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {list.data?.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setEditing(c)}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{c.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{c.vpa ?? c.key}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{c.txnCount}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && <PayeeSheet key={editing.id} payee={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PayeeSheet({ payee, onClose }: { payee: CounterpartyDto; onClose: () => void }) {
  const rename = useRenameCounterparty();
  const merge = useMergeCounterparty();
  const [name, setName] = useState(payee.name);
  const [search, setSearch] = useState('');
  const candidates = useCounterparties(search.trim(), 30);
  const [targetId, setTargetId] = useState('');
  const others = (candidates.data ?? []).filter((c) => c.id !== payee.id);

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Payee"
      footer={
        <Button
          className="w-full"
          disabled={rename.isPending || !name.trim() || name.trim() === payee.name}
          onClick={() =>
            rename.mutate(
              { id: payee.id, displayName: name.trim() },
              {
                onSuccess: () => {
                  toast.success('Payee renamed');
                  onClose();
                },
                onError: (e) => toast.error(errorMessage(e)),
              },
            )
          }
        >
          Save name
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Display name" htmlFor="payee-name">
          <Input
            id="payee-name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <p className="text-xs break-all text-muted-foreground">
          Key: {payee.key} · {payee.txnCount} transactions
        </p>
        <Link
          to={`/transactions?q=${encodeURIComponent(payee.name)}`}
          className="min-h-11 text-sm text-primary"
          onClick={onClose}
        >
          See transactions
        </Link>

        <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-medium">Merge into another payee</legend>
          <p className="text-xs text-muted-foreground">
            Moves all transactions and learned labels to the other payee. Future imports of this
            payee land there too.
          </p>
          <Input
            aria-label="Find payee to merge into"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            aria-label="Merge target"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">Choose payee</option>
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.vpa ?? c.key})
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            disabled={!targetId || merge.isPending}
            onClick={() =>
              merge.mutate(
                { id: payee.id, targetId },
                {
                  onSuccess: (r) => {
                    toast.success(`Merged · ${r.moved} transactions moved`);
                    onClose();
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          >
            Merge
          </Button>
        </fieldset>
      </div>
    </Sheet>
  );
}
