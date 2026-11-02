import { AlertTriangle, CheckCircle2, MessageSquareText, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  type AlertsPreviewResponse,
  alertToRow,
  formatINR,
  isIsoDate,
  MAX_ALERT_TEXT,
  matchAlertAccount,
  type ParsedAlert,
  parseAlerts,
  SKIP_REASON_LABEL,
  type SkippedAlert,
  toIstDate,
} from '@kharcha/shared';
import { useAccounts, useCommitAlerts, usePreviewAlerts } from '@/app/queries';
import { EmptyState } from '@/components/EmptyState';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CheckRow, KIND_LABEL, PreviewLine, Section, Stat } from './PreviewParts';

interface Draft extends ParsedAlert {
  accountId: string;
}

type Step =
  | { kind: 'input' }
  | { kind: 'review'; drafts: Draft[]; skipped: SkippedAlert[] }
  | { kind: 'preview'; result: AlertsPreviewResponse }
  | { kind: 'done'; inserted: number; skipped: number; confirmed: number; uncategorized: number };

const textareaClass =
  'min-h-48 w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

/** Paste bank SMS / alert text (spec §3.3): parse in the browser → assign accounts → check → add. */
export function PasteAlertsPage() {
  const accounts = useAccounts();
  const previewM = usePreviewAlerts();
  const [text, setText] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'input' });

  const active = useMemo(() => (accounts.data ?? []).filter((a) => a.active), [accounts.data]);

  function read() {
    const { alerts, skipped } = parseAlerts(text, { fallbackDate: toIstDate() });
    if (alerts.length === 0) {
      toast.error(
        skipped.length
          ? 'None of these look like completed transactions (OTPs, reminders and offers are skipped).'
          : 'Paste at least one bank SMS or alert.',
      );
      return;
    }
    setStep({
      kind: 'review',
      skipped,
      drafts: alerts.map((a) => ({ ...a, accountId: matchAlertAccount(a, active) ?? '' })),
    });
  }

  async function check(drafts: Draft[]) {
    try {
      const result = await previewM.mutateAsync({
        rows: drafts.map((d) => ({ ...alertToRow(d), accountId: d.accountId })),
      });
      setStep({ kind: 'preview', result });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (accounts.isPending) return null;
  if (active.length === 0) {
    return (
      <EmptyState icon={MessageSquareText} title="Add an account first">
        <Link to="/more/accounts" className="font-medium text-primary underline">
          Go to Accounts
        </Link>
      </EmptyState>
    );
  }

  if (step.kind === 'review') {
    return (
      <ReviewStep
        drafts={step.drafts}
        skipped={step.skipped}
        accounts={active}
        busy={previewM.isPending}
        onChange={(drafts) => setStep({ ...step, drafts })}
        onBack={() => setStep({ kind: 'input' })}
        onCheck={(drafts) => void check(drafts)}
      />
    );
  }
  if (step.kind === 'preview') {
    return (
      <PreviewStep
        result={step.result}
        accountName={(id) => active.find((a) => a.id === id)?.name ?? 'Account'}
        onDone={(r) => {
          setText('');
          setStep({ kind: 'done', ...r });
        }}
      />
    );
  }
  if (step.kind === 'done') {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <CheckCircle2 aria-hidden className="size-12 text-income" />
        <h2 className="text-lg font-semibold">
          Added {step.inserted} transaction{step.inserted === 1 ? '' : 's'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {step.skipped > 0 && `${step.skipped} already in Kharcha were skipped. `}
          {step.confirmed > 0 && `${step.confirmed} matched existing entries.`}
        </p>
        {step.uncategorized > 0 && (
          <Link to="/inbox" className="min-h-11 text-sm font-medium text-primary">
            Label the remaining {step.uncategorized} →
          </Link>
        )}
        <div className="grid w-full grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setStep({ kind: 'input' })}>
            Paste more
          </Button>
          <Link
            to="/transactions"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            View transactions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Copy one or more bank SMS or e-mail alerts and paste them here. Leave a blank line between
        messages if they run together. OTPs, reminders and offers are ignored.
      </p>
      <Field label="Bank messages" htmlFor="alerts-text">
        <textarea
          id="alerts-text"
          className={textareaClass}
          value={text}
          maxLength={MAX_ALERT_TEXT}
          placeholder="Sent Rs.420.00 From HDFC Bank A/C *1234 To SWIGGY On 01/11/26 Ref 4305…"
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        Messages are read on this device; only the amounts, dates and payees go to Kharcha. Accounts
        are matched by the last digits printed in the message.
      </p>
      <div className="sticky bottom-20 z-10 -mx-4 border-t border-border bg-background px-4 pt-3 pb-2">
        <Button className="w-full" disabled={!text.trim()} onClick={read}>
          Read messages
        </Button>
      </div>
      <Link to="/import" className="min-h-11 text-center text-sm text-primary">
        Import a statement file instead
      </Link>
    </div>
  );
}

function ReviewStep({
  drafts,
  skipped,
  accounts,
  busy,
  onChange,
  onBack,
  onCheck,
}: {
  drafts: Draft[];
  skipped: SkippedAlert[];
  accounts: { id: string; name: string }[];
  busy: boolean;
  onChange: (d: Draft[]) => void;
  onBack: () => void;
  onCheck: (d: Draft[]) => void;
}) {
  const unassigned = drafts.filter((d) => !d.accountId).length;
  const badDate = drafts.some((d) => !isIsoDate(d.txnDate));
  const update = (index: number, patch: Partial<Draft>) =>
    onChange(drafts.map((d) => (d.index === index ? { ...d, ...patch } : d)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {drafts.length} transaction{drafts.length === 1 ? '' : 's'} found
        </h2>
        <Button variant="ghost" onClick={onBack}>
          Edit text
        </Button>
      </div>

      {unassigned > 0 && (
        <div className="flex flex-col gap-2 rounded-lg bg-accent p-3 text-sm text-accent-foreground">
          <p className="flex gap-2">
            <AlertTriangle aria-hidden className="size-5 shrink-0" />
            {unassigned} couldn't be matched to an account by its last digits. Pick one below, or:
          </p>
          <Select
            aria-label="Account for all unmatched messages"
            value=""
            onChange={(e) =>
              e.target.value &&
              onChange(drafts.map((d) => (d.accountId ? d : { ...d, accountId: e.target.value })))
            }
          >
            <option value="">Set all unmatched to…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {drafts.map((d) => (
          <li key={d.index}>
            <Card className="flex flex-col gap-2 p-3">
              <div className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    {d.payee ?? d.vpa ?? d.narration}
                  </span>
                  <span className="truncate text-xs text-muted-foreground" title={d.raw}>
                    {d.raw}
                  </span>
                </div>
                <Money
                  paise={d.amountPaise}
                  direction={d.direction}
                  className="shrink-0 text-sm font-semibold"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove message ${d.index + 1}`}
                  onClick={() => onChange(drafts.filter((x) => x.index !== d.index))}
                >
                  <X aria-hidden className="size-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  aria-label={`Account for message ${d.index + 1}`}
                  value={d.accountId}
                  className={cn(!d.accountId && 'border-expense')}
                  onChange={(e) => update(d.index, { accountId: e.target.value })}
                >
                  <option value="">Account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
                <Input
                  type="date"
                  aria-label={`Date for message ${d.index + 1}`}
                  value={d.txnDate}
                  className={cn(!d.dateFromText && 'border-amber-500')}
                  onChange={(e) => update(d.index, { txnDate: e.target.value, dateFromText: true })}
                />
              </div>
              {!d.dateFromText && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  No date in this message; check it.
                </p>
              )}
            </Card>
          </li>
        ))}
      </ul>

      {skipped.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-muted-foreground">
            Ignored messages ({skipped.length})
          </summary>
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {skipped.map((s) => (
              <li key={s.index} className="truncate">
                <strong className="font-medium">{SKIP_REASON_LABEL[s.reason]}:</strong> {s.raw}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="sticky bottom-20 z-10 -mx-4 border-t border-border bg-background px-4 pt-3 pb-2">
        <Button
          className="w-full"
          disabled={drafts.length === 0 || unassigned > 0 || badDate || busy}
          onClick={() => onCheck(drafts)}
        >
          {busy
            ? 'Checking…'
            : unassigned > 0
              ? `Choose an account for ${unassigned}`
              : 'Check for duplicates'}
        </Button>
      </div>
    </div>
  );
}

function PreviewStep({
  result,
  accountName,
  onDone,
}: {
  result: AlertsPreviewResponse;
  accountName: (id: string) => string;
  onDone: (r: {
    inserted: number;
    skipped: number;
    confirmed: number;
    uncategorized: number;
  }) => void;
}) {
  const commit = useCommitAlerts();
  const rows = result.groups.flatMap((g) => g.preview.rows.map((r) => ({ g, r })));
  const key = (importId: string, index: number) => `${importId}:${index}`;
  const [accept, setAccept] = useState(
    () =>
      new Set(
        rows
          .filter(({ r }) => r.transfer?.confidence === 'high' && r.status !== 'duplicate')
          .map(({ g, r }) => key(g.importId, r.index)),
      ),
  );
  const [include, setInclude] = useState(() => new Set<string>());
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, k: string) => {
    const next = new Set(set);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setter(next);
  };
  const fresh = rows.filter(({ r }) => r.status === 'new').length;
  const toAdd = fresh + include.size;

  async function confirm() {
    try {
      const r = await commit.mutateAsync({
        groups: result.groups.map((g) => ({
          importId: g.importId,
          includeNearDuplicates: g.preview.rows
            .filter((r) => include.has(key(g.importId, r.index)))
            .map((r) => r.index),
          acceptTransfers: g.preview.rows
            .filter((r) => accept.has(key(g.importId, r.index)))
            .map((r) => r.index),
        })),
      });
      toast.success(`Added ${r.inserted} transactions`);
      onDone({
        inserted: r.inserted,
        skipped: r.skippedDuplicates,
        confirmed: r.alertsConfirmed,
        uncategorized: r.inserted - r.transfersLinked - r.categorized,
      });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2 text-sm" aria-label="Summary">
        <Stat label="New" value={fresh} tone="text-income" />
        <Stat
          label="Already added"
          value={rows.filter(({ r }) => r.status === 'duplicate').length}
        />
        <Stat
          label="Possible duplicates"
          value={rows.filter(({ r }) => r.status === 'near_duplicate').length}
        />
      </div>

      {result.groups.map((g) => {
        const transfers = g.preview.rows.filter((r) => r.transfer && r.status !== 'duplicate');
        const near = g.preview.rows.filter((r) => r.status === 'near_duplicate');
        const news = g.preview.rows.filter((r) => r.status === 'new');
        const dupes = g.preview.rows.filter((r) => r.status === 'duplicate');
        return (
          <section
            key={g.importId}
            aria-label={accountName(g.accountId)}
            className="flex flex-col gap-3"
          >
            <h2 className="text-base font-semibold">{accountName(g.accountId)}</h2>
            {transfers.length > 0 && (
              <Section
                title={`Transfers (${transfers.length})`}
                hint="Ticked rows aren't spending."
              >
                {transfers.map((r) => (
                  <CheckRow
                    key={r.index}
                    row={r}
                    checked={accept.has(key(g.importId, r.index))}
                    onToggle={() => toggle(accept, setAccept, key(g.importId, r.index))}
                    label={`Mark message ${r.sourceRow} as transfer`}
                    detail={
                      r.transfer ? `${KIND_LABEL[r.transfer.kind]} — ${r.transfer.reason}` : ''
                    }
                  />
                ))}
              </Section>
            )}
            {near.length > 0 && (
              <Section title={`Possible duplicates (${near.length})`} hint="Skipped unless ticked.">
                {near.map((r) => (
                  <CheckRow
                    key={r.index}
                    row={r}
                    checked={include.has(key(g.importId, r.index))}
                    onToggle={() => toggle(include, setInclude, key(g.importId, r.index))}
                    label={`Add message ${r.sourceRow} anyway`}
                    detail={
                      r.match &&
                      `Looks like ${r.match.txnDate} · ${r.match.narration ?? 'manual entry'} · ${formatINR(r.match.amountPaise)}`
                    }
                  />
                ))}
              </Section>
            )}
            {news.length > 0 && (
              <Section title={`New (${news.length})`}>
                {news.map((r) => (
                  <PreviewLine key={r.index} row={r} />
                ))}
              </Section>
            )}
            {dupes.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {dupes.length} already in Kharcha — will be skipped.
              </p>
            )}
          </section>
        );
      })}

      <div className="sticky bottom-20 z-10 -mx-4 border-t border-border bg-background px-4 pt-3 pb-2">
        <Button
          className="w-full"
          disabled={toAdd === 0 || commit.isPending}
          onClick={() => void confirm()}
        >
          {toAdd === 0 ? 'Nothing new to add' : `Add ${toAdd} transaction${toAdd === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  );
}
