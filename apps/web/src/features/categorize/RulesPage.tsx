import { ArrowDown, ArrowUp, BookOpenCheck, Plus, Trash2, Wand2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type AccountDto,
  CHANNELS,
  formatINR,
  type LearnedLabelDto,
  parseRupeesToPaise,
  type RuleCondition,
  type RuleConditions,
  ruleConditionsSchema,
  type RuleDto,
} from '@kharcha/shared';
import {
  useAccounts,
  useApplyRule,
  useCategoryMap,
  useDeleteLearnedLabel,
  useDeleteRule,
  useLearnedLabels,
  useReorderRules,
  useRules,
  useSaveRule,
  useTestRule,
  useUpdateLearnedLabel,
} from '@/app/queries';
import { CategoryIcon } from '@/components/CategoryIcon';
import { EmptyState } from '@/components/EmptyState';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select, Switch } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { categoryLabel } from '@/lib/categories';
import { cn } from '@/lib/utils';
import { CategoryPicker } from '@/features/categories/CategoryPicker';
import { useUndoToast } from './LabelSheet';

type Tab = 'rules' | 'learned';

export function RulesPage() {
  const [tab, setTab] = useState<Tab>('rules');
  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Rules"
        className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1"
      >
        {(
          [
            ['rules', 'Rules'],
            ['learned', 'Learned labels'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              'min-h-11 rounded-md text-sm font-semibold',
              tab === value ? 'bg-card shadow' : 'text-muted-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'rules' ? <RulesTab /> : <LearnedTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------- descriptions

const FIELD_LABEL: Record<RuleCondition['field'], string> = {
  narration: 'Description',
  counterparty_key: 'Payee',
  vpa: 'UPI ID',
  amount: 'Amount',
  direction: 'Direction',
  account_id: 'Account',
  channel: 'Payment type',
};

export function describeCondition(c: RuleCondition, accounts: AccountDto[]): string {
  const f = FIELD_LABEL[c.field];
  switch (c.field) {
    case 'narration':
    case 'counterparty_key':
    case 'vpa':
      return `${f} ${c.op === 'contains' ? 'contains' : c.op === 'eq' ? 'is' : 'matches'} “${c.value}”`;
    case 'amount':
      if (c.op === 'between') return `${f} ${formatINR(c.value[0])}–${formatINR(c.value[1])}`;
      return `${f} ${c.op === 'eq' ? '=' : c.op === 'gte' ? '≥' : '≤'} ${formatINR(c.value)}`;
    case 'direction':
      return c.value === 'out' ? 'Money out' : 'Money in';
    case 'account_id':
      return `${f}: ${c.value.map((id) => accounts.find((a) => a.id === id)?.name ?? '?').join(', ')}`;
    case 'channel':
      return `${f}: ${c.value.map((v) => v.toUpperCase()).join(', ')}`;
  }
}

// ---------------------------------------------------------------------------- rules tab

function RulesTab() {
  const rules = useRules();
  const accounts = useAccounts();
  const { byId } = useCategoryMap();
  const reorder = useReorderRules();
  const save = useSaveRule();
  const [editing, setEditing] = useState<RuleDto | 'new' | null>(null);

  const move = (index: number, delta: number) => {
    const list = [...(rules.data ?? [])];
    const [item] = list.splice(index, 1);
    if (!item) return;
    list.splice(index + delta, 0, item);
    reorder.mutate(
      list.map((r) => r.id),
      { onError: (e) => toast.error(errorMessage(e)) },
    );
  };

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Rules run top to bottom; the first match wins. They beat learned labels and keywords, but
        never change a category you set by hand.
      </p>
      <Button onClick={() => setEditing('new')}>
        <Plus aria-hidden className="size-4" /> New rule
      </Button>
      {rules.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : (rules.data ?? []).length === 0 ? (
        <EmptyState icon={Wand2} title="No rules yet">
          Example: Description contains “landlord” and Amount ≥ ₹10,000 → Rent.
        </EmptyState>
      ) : (
        <ol className="flex flex-col gap-2">
          {rules.data?.map((r, i) => (
            <li key={r.id}>
              <Card className={cn('flex items-center gap-2 p-2', !r.enabled && 'opacity-60')}>
                <button
                  type="button"
                  className="flex min-h-14 min-w-0 flex-1 flex-col items-start gap-0.5 px-1 text-left"
                  onClick={() => setEditing(r)}
                >
                  <span className="w-full truncate text-sm font-medium">
                    {i + 1}. {r.name}
                  </span>
                  <span className="w-full truncate text-xs text-muted-foreground">
                    {r.conditions.all
                      .map((c) => describeCondition(c, accounts.data ?? []))
                      .join(' · ')}
                  </span>
                  <span className="w-full truncate text-xs">
                    → {categoryLabel(byId, r.categoryId)} · {r.hitCount} hit
                    {r.hitCount === 1 ? '' : 's'}
                  </span>
                </button>
                <div className="flex shrink-0 flex-col">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${r.name} up`}
                    disabled={i === 0 || reorder.isPending}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp aria-hidden className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${r.name} down`}
                    disabled={i === (rules.data?.length ?? 0) - 1 || reorder.isPending}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown aria-hidden className="size-4" />
                  </Button>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={r.enabled}
                  aria-label={`${r.name} enabled`}
                  onClick={() => save.mutate({ id: r.id, body: { enabled: !r.enabled } })}
                  className={cn(
                    'relative h-7 w-12 shrink-0 rounded-full transition-colors',
                    r.enabled ? 'bg-primary' : 'bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-1 size-5 rounded-full bg-white shadow transition-transform',
                      r.enabled ? 'translate-x-6' : 'translate-x-1',
                    )}
                  />
                </button>
              </Card>
            </li>
          ))}
        </ol>
      )}
      {editing && (
        <RuleEditor
          key={editing === 'new' ? 'new' : editing.id}
          rule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------- editor

interface DraftCondition {
  key: number;
  field: RuleCondition['field'];
  op: string;
  value: string;
  value2: string;
}

const TEXT_OPS = [
  ['contains', 'contains'],
  ['eq', 'is exactly'],
  ['regex', 'matches pattern'],
] as const;
const AMOUNT_OPS = [
  ['gte', 'at least'],
  ['lte', 'at most'],
  ['eq', 'exactly'],
  ['between', 'between'],
] as const;

const defaultOp = (field: RuleCondition['field']) =>
  field === 'amount'
    ? 'gte'
    : field === 'direction'
      ? 'eq'
      : field === 'account_id' || field === 'channel'
        ? 'in'
        : 'contains';

const paiseToInput = (p: number) => (p / 100).toFixed(2).replace(/\.00$/, '');

function toDraft(c: RuleCondition, key: number): DraftCondition {
  switch (c.field) {
    case 'amount':
      return c.op === 'between'
        ? {
            key,
            field: c.field,
            op: c.op,
            value: paiseToInput(c.value[0]),
            value2: paiseToInput(c.value[1]),
          }
        : { key, field: c.field, op: c.op, value: paiseToInput(c.value), value2: '' };
    case 'account_id':
    case 'channel':
      return { key, field: c.field, op: 'in', value: c.value[0] ?? '', value2: '' };
    default:
      return { key, field: c.field, op: c.op, value: c.value, value2: '' };
  }
}

function fromDraft(d: DraftCondition): unknown {
  switch (d.field) {
    case 'amount': {
      const a = parseRupeesToPaise(d.value) ?? Number.NaN;
      return d.op === 'between'
        ? { field: 'amount', op: 'between', value: [a, parseRupeesToPaise(d.value2) ?? Number.NaN] }
        : { field: 'amount', op: d.op, value: a };
    }
    case 'account_id':
    case 'channel':
      return { field: d.field, op: 'in', value: d.value ? [d.value] : [] };
    default:
      return { field: d.field, op: d.op, value: d.value };
  }
}

function RuleEditor({ rule, onClose }: { rule: RuleDto | null; onClose: () => void }) {
  const accounts = useAccounts();
  const { byId } = useCategoryMap();
  const save = useSaveRule();
  const remove = useDeleteRule();
  const test = useTestRule();
  const apply = useApplyRule();
  const showUndo = useUndoToast();

  const [name, setName] = useState(rule?.name ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(rule?.categoryId ?? null);
  const [conditions, setConditions] = useState<DraftCondition[]>(
    rule?.conditions.all.map(toDraft) ?? [
      { key: 0, field: 'narration', op: 'contains', value: '', value2: '' },
    ],
  );
  const [tags, setTags] = useState((rule?.setTags ?? []).join(' '));
  const [note, setNote] = useState(rule?.setNote ?? '');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = (key: number, patch: Partial<DraftCondition>) =>
    setConditions((list) => list.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  function parsedConditions(): RuleConditions | null {
    const parsed = ruleConditionsSchema.safeParse({ all: conditions.map(fromDraft) });
    if (parsed.success) return parsed.data;
    const issue = parsed.error.issues[0];
    const index = typeof issue?.path[1] === 'number' ? issue.path[1] + 1 : null;
    setErrors({
      conditions: `${index ? `Condition ${index}: ` : ''}${issue?.message ?? 'Check the conditions'}`,
    });
    return null;
  }

  function runTest() {
    setErrors({});
    const c = parsedConditions();
    if (c) test.mutate(c, { onError: (e) => toast.error(errorMessage(e)) });
  }

  async function submit(andApply: boolean) {
    setErrors({});
    const c = parsedConditions();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Give the rule a name';
    if (!categoryId) next.categoryId = 'Choose a category';
    if (!c || Object.keys(next).length) {
      setErrors((e) => ({ ...e, ...next }));
      return;
    }
    try {
      const body = {
        name: name.trim(),
        conditions: c,
        categoryId: categoryId as string,
        setTags: tags.split(/[\s,]+/).filter(Boolean),
        setNote: note.trim() || null,
        enabled,
      };
      const saved = await save.mutateAsync(rule ? { id: rule.id, body } : { body });
      if (andApply) {
        const r = await apply.mutateAsync(saved.rule.id);
        showUndo(
          `Rule saved · ${r.changed} past transaction${r.changed === 1 ? '' : 's'} updated`,
          r.batchId,
        );
      } else {
        toast.success('Rule saved');
      }
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError && err.issues.length) {
        setErrors(
          Object.fromEntries(err.issues.map((i) => [i.path.split('.')[0] ?? 'form', i.message])),
        );
      } else toast.error(errorMessage(err));
    }
  }

  const category = categoryId ? byId.get(categoryId) : undefined;
  const busy = save.isPending || apply.isPending;

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={rule ? 'Edit rule' : 'New rule'}
      footer={
        <div className="flex gap-2">
          {rule && (
            <Button
              variant="outline"
              aria-label="Delete rule"
              onClick={() =>
                remove.mutate(rule.id, {
                  onSuccess: () => {
                    toast('Rule deleted');
                    onClose();
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              <Trash2 aria-hidden className="size-4 text-expense" />
            </Button>
          )}
          <Button
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => void submit(false)}
          >
            Save
          </Button>
          <Button className="flex-1" disabled={busy} onClick={() => void submit(true)}>
            {apply.isPending ? 'Applying…' : 'Save & apply'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor="rule-name" error={errors.name}>
          <Input
            id="rule-name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">When all of these match</legend>
          {conditions.map((c, i) => (
            <ConditionRow
              key={c.key}
              index={i}
              draft={c}
              accounts={accounts.data ?? []}
              canRemove={conditions.length > 1}
              onChange={(patch) => update(c.key, patch)}
              onRemove={() => setConditions((list) => list.filter((x) => x.key !== c.key))}
            />
          ))}
          {conditions.length < 10 && (
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-primary"
              onClick={() =>
                setConditions((list) => [
                  ...list,
                  { key: Date.now(), field: 'amount', op: 'gte', value: '', value2: '' },
                ])
              }
            >
              <Plus aria-hidden className="size-4" /> Add condition
            </button>
          )}
          {errors.conditions && (
            <p role="alert" className="text-sm text-expense">
              {errors.conditions}
            </p>
          )}
        </fieldset>

        <Field label="Then categorize as" error={errors.categoryId}>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex min-h-12 items-center gap-3 rounded-md border border-border px-3 text-left"
          >
            <CategoryIcon
              icon={category?.icon ?? 'circle-help'}
              color={category?.color}
              className="size-8"
            />
            <span className={cn('min-w-0 truncate text-sm', !category && 'text-muted-foreground')}>
              {category ? categoryLabel(byId, categoryId) : 'Choose category'}
            </span>
          </button>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Add tags (new only)" htmlFor="rule-tags" error={errors.setTags}>
            <Input
              id="rule-tags"
              placeholder="e.g. home"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </Field>
          <Field label="Set note (new only)" htmlFor="rule-note" error={errors.setNote}>
            <Input
              id="rule-note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
        <Switch label="Enabled" checked={enabled} onCheckedChange={setEnabled} />

        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <Button variant="outline" onClick={runTest} disabled={test.isPending}>
            <BookOpenCheck aria-hidden className="size-4" />
            {test.isPending ? 'Testing…' : 'Test against my history'}
          </Button>
          {test.data && (
            <div className="flex flex-col gap-2" aria-live="polite">
              <p className="text-sm">
                Matches <strong>{test.data.matched}</strong> of {test.data.scanned}
                {test.data.truncated ? ' most recent' : ''} transactions
                {test.data.manual > 0 && ` (${test.data.manual} set by hand won't change)`}.
              </p>
              <ul className="divide-y divide-border text-sm">
                {test.data.sample.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 py-1.5">
                    <span className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">
                      {s.txnDate}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <Money
                      paise={s.amountPaise}
                      direction={s.direction}
                      className="shrink-0 text-xs"
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <CategoryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selectedId={categoryId}
        direction={
          conditions.some((c) => c.field === 'direction' && c.value === 'in') ? 'in' : 'out'
        }
        onSelect={(c) => setCategoryId(c.id)}
      />
    </Sheet>
  );
}

function ConditionRow({
  index,
  draft,
  accounts,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  draft: DraftCondition;
  accounts: AccountDto[];
  canRemove: boolean;
  onChange: (patch: Partial<DraftCondition>) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  const isText =
    draft.field === 'narration' || draft.field === 'counterparty_key' || draft.field === 'vpa';
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-2">
      <div className="flex gap-2">
        <Select
          aria-label={`Condition ${n} field`}
          value={draft.field}
          className="flex-1"
          onChange={(e) => {
            const field = e.target.value as RuleCondition['field'];
            onChange({
              field,
              op: defaultOp(field),
              value: field === 'direction' ? 'out' : '',
              value2: '',
            });
          }}
        >
          {Object.entries(FIELD_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        {(isText || draft.field === 'amount') && (
          <Select
            aria-label={`Condition ${n} operator`}
            value={draft.op}
            className="flex-1"
            onChange={(e) => onChange({ op: e.target.value })}
          >
            {(isText ? TEXT_OPS : AMOUNT_OPS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove condition ${n}`}
          disabled={!canRemove}
          onClick={onRemove}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>
      {isText && (
        <Input
          aria-label={`Condition ${n} value`}
          value={draft.value}
          placeholder={draft.op === 'regex' ? 'e.g. (swiggy|zomato)' : 'e.g. landlord'}
          onChange={(e) => onChange({ value: e.target.value })}
        />
      )}
      {draft.field === 'amount' && (
        <div className="flex items-center gap-2">
          <Input
            aria-label={`Condition ${n} amount`}
            inputMode="decimal"
            placeholder="₹"
            value={draft.value}
            onChange={(e) => onChange({ value: e.target.value })}
          />
          {draft.op === 'between' && (
            <>
              <span className="text-sm text-muted-foreground">and</span>
              <Input
                aria-label={`Condition ${n} maximum`}
                inputMode="decimal"
                placeholder="₹"
                value={draft.value2}
                onChange={(e) => onChange({ value2: e.target.value })}
              />
            </>
          )}
        </div>
      )}
      {draft.field === 'direction' && (
        <Select
          aria-label={`Condition ${n} direction`}
          value={draft.value}
          onChange={(e) => onChange({ value: e.target.value })}
        >
          <option value="out">Money out</option>
          <option value="in">Money in</option>
        </Select>
      )}
      {draft.field === 'account_id' && (
        <Select
          aria-label={`Condition ${n} account`}
          value={draft.value}
          onChange={(e) => onChange({ value: e.target.value })}
        >
          <option value="">Choose account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      )}
      {draft.field === 'channel' && (
        <Select
          aria-label={`Condition ${n} payment type`}
          value={draft.value}
          onChange={(e) => onChange({ value: e.target.value })}
        >
          <option value="">Choose type</option>
          {CHANNELS.map((ch) => (
            <option key={ch} value={ch}>
              {ch.toUpperCase()}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- learned tab

function LearnedTab() {
  const labels = useLearnedLabels();
  const accounts = useAccounts();
  const { byId } = useCategoryMap();
  const update = useUpdateLearnedLabel();
  const remove = useDeleteLearnedLabel();
  const [picking, setPicking] = useState<LearnedLabelDto | null>(null);

  if (labels.isPending) return <Skeleton className="h-32 w-full" />;
  if ((labels.data ?? []).length === 0) {
    return (
      <EmptyState icon={BookOpenCheck} title="Nothing learned yet">
        When you categorize a transaction and choose “All future”, Kharcha remembers that payee
        here.
      </EmptyState>
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-2">
        {labels.data?.map((l) => {
          const c = byId.get(l.categoryId);
          const scope = [
            l.direction === 'out' ? 'Money out' : l.direction === 'in' ? 'Money in' : null,
            l.accountId ? accounts.data?.find((a) => a.id === l.accountId)?.name : null,
          ].filter(Boolean);
          return (
            <li key={l.id}>
              <Card className={cn('flex items-center gap-2 p-2', !l.enabled && 'opacity-60')}>
                <button
                  type="button"
                  className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-1 text-left"
                  onClick={() => setPicking(l)}
                >
                  <CategoryIcon icon={c?.icon} color={c?.color} className="size-9" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{l.counterparty.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      → {c?.name ?? '?'}
                      {scope.length ? ` · ${scope.join(' · ')}` : ''} · {l.hitCount} hit
                      {l.hitCount === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={l.enabled}
                  aria-label={`${l.counterparty.name} enabled`}
                  onClick={() => update.mutate({ id: l.id, body: { enabled: !l.enabled } })}
                  className={cn(
                    'relative h-7 w-12 shrink-0 rounded-full transition-colors',
                    l.enabled ? 'bg-primary' : 'bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-1 size-5 rounded-full bg-white shadow transition-transform',
                      l.enabled ? 'translate-x-6' : 'translate-x-1',
                    )}
                  />
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Forget ${l.counterparty.name}`}
                  onClick={() =>
                    remove.mutate(l.id, {
                      onSuccess: () => toast('Forgotten. Past transactions keep their category.'),
                      onError: (e) => toast.error(errorMessage(e)),
                    })
                  }
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </Card>
            </li>
          );
        })}
      </ul>
      <CategoryPicker
        nested={false}
        open={picking !== null}
        onOpenChange={(o) => !o && setPicking(null)}
        selectedId={picking?.categoryId}
        direction={picking?.direction ?? 'out'}
        onSelect={(c) =>
          picking &&
          update.mutate(
            { id: picking.id, body: { categoryId: c.id } },
            { onError: (e) => toast.error(errorMessage(e)) },
          )
        }
      />
    </>
  );
}
