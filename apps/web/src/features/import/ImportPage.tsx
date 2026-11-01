import { AlertTriangle, ArrowLeftRight, CheckCircle2, FileUp, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  type AccountDto,
  type ColumnMapping,
  type Grid,
  type ImportPreviewResponse,
  MAX_IMPORT_ROWS,
  type PreviewRow,
  detectProfile,
  formatINR,
  guessGenericMapping,
  parseGrid,
} from '@kharcha/shared';
import {
  useAccounts,
  useCommitImport,
  useParserProfiles,
  usePreviewImport,
  useSaveParserProfile,
  useUploadStatement,
} from '@/app/queries';
import { EmptyState } from '@/components/EmptyState';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { MappingWizard } from './MappingWizard';
import { readStatementFile } from './readStatement';

type Step =
  | { kind: 'select' }
  | {
      kind: 'wizard';
      file: File;
      grid: Grid;
      initial: ColumnMapping | null;
      importId: string | null;
      note?: string;
    }
  | {
      kind: 'preview';
      file: File;
      grid: Grid;
      mapping: ColumnMapping;
      importId: string;
      profileLabel: string;
      preview: ImportPreviewResponse;
      parseErrors: { sourceRow: number; message: string }[];
      duplicateOf: { fileName: string | null; committedAt: number | null } | null;
    }
  | { kind: 'done'; importId: string; inserted: number; skipped: number; transfers: number };

const LAST_IMPORT_ACCOUNT = 'kharcha.lastImportAccountId';

export function ImportPage() {
  const accounts = useAccounts();
  const profiles = useParserProfiles();
  const upload = useUploadStatement();
  const previewM = usePreviewImport();
  const saveProfile = useSaveParserProfile();
  const [step, setStep] = useState<Step>({ kind: 'select' });
  const [accountId, setAccountId] = useState(() => localStorage.getItem(LAST_IMPORT_ACCOUNT) ?? '');
  const [busy, setBusy] = useState<string | null>(null);

  const active = (accounts.data ?? []).filter((a) => a.active && a.type !== 'cash');
  const account: AccountDto | undefined = active.find((a) => a.id === accountId) ?? active[0];

  async function runPreview(
    file: File,
    grid: Grid,
    mapping: ColumnMapping,
    profileId: string,
    label: string,
    existingImportId: string | null,
  ) {
    if (!account) return;
    const parsed = parseGrid(grid, mapping);
    if (parsed.rows.length === 0) {
      setStep({
        kind: 'wizard',
        file,
        grid,
        initial: mapping,
        importId: existingImportId,
        note: 'No transactions were found with these columns. Adjust the mapping.',
      });
      return;
    }
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      toast.error(
        `This file has ${parsed.rows.length} transactions; split it into files of up to ${MAX_IMPORT_ROWS}.`,
      );
      return;
    }
    setBusy('Checking for duplicates and transfers…');
    try {
      let importId = existingImportId;
      let duplicateOf: { fileName: string | null; committedAt: number | null } | null = null;
      if (!importId) {
        const up = await upload.mutateAsync({ accountId: account.id, file });
        importId = up.importId;
        duplicateOf = up.duplicateOf;
      }
      const preview = await previewM.mutateAsync({
        importId,
        body: {
          profileId,
          rows: parsed.rows,
          statementFrom: parsed.from,
          statementTo: parsed.to,
          closingBalancePaise: parsed.closingBalancePaise,
          parseErrors: parsed.errors.length,
        },
      });
      setStep({
        kind: 'preview',
        file,
        grid,
        mapping,
        importId,
        profileLabel: label,
        preview,
        parseErrors: parsed.errors,
        duplicateOf,
      });
    } finally {
      setBusy(null);
    }
  }

  async function onFile(file: File) {
    if (!account) return;
    localStorage.setItem(LAST_IMPORT_ACCOUNT, account.id);
    setBusy('Reading statement…');
    try {
      const grid = await readStatementFile(file);
      const saved = profiles.data?.find((p) => p.id === account.parserProfileId);
      if (saved) {
        const r = parseGrid(grid, saved.mapping);
        if (r.rows.length > 0 && r.errors.length === 0)
          return await runPreview(file, grid, saved.mapping, saved.id, saved.name, null);
      }
      const detected = detectProfile(grid, { bank: account.bank, accountType: account.type });
      if (detected)
        return await runPreview(
          file,
          grid,
          detected.mapping,
          detected.profile.id,
          detected.profile.label,
          null,
        );
      setStep({
        kind: 'wizard',
        file,
        grid,
        initial: guessGenericMapping(grid)?.mapping ?? null,
        importId: null,
        note: "We didn't recognise this format. Map the columns once and we'll remember it.",
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (accounts.isPending) return null;
  if (active.length === 0) {
    return (
      <EmptyState icon={FileUp} title="Add a bank or card account first">
        <Link to="/more/accounts" className="font-medium text-primary underline">
          Go to Accounts
        </Link>
      </EmptyState>
    );
  }

  if (busy) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-3 py-20 text-sm text-muted-foreground"
      >
        <span
          className="size-8 animate-spin rounded-full border-4 border-muted border-t-primary"
          aria-hidden
        />
        {busy}
      </div>
    );
  }

  if (step.kind === 'wizard') {
    return (
      <div className="flex flex-col gap-3">
        {step.note && (
          <p role="alert" className="rounded-lg bg-accent p-3 text-sm text-accent-foreground">
            {step.note}
          </p>
        )}
        <MappingWizard
          grid={step.grid}
          initial={step.initial}
          defaultProfileName={`${account?.name ?? 'Bank'} statement`}
          onCancel={() => setStep({ kind: 'select' })}
          onConfirm={async ({ mapping, remember }) => {
            try {
              let profileId = 'custom';
              let label = 'Custom columns';
              if (remember && account) {
                const { profile } = await saveProfile.mutateAsync({
                  name: remember.name,
                  mapping,
                  accountId: account.id,
                });
                profileId = profile.id;
                label = profile.name;
              }
              await runPreview(step.file, step.grid, mapping, profileId, label, step.importId);
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        />
      </div>
    );
  }

  if (step.kind === 'preview') {
    return (
      <PreviewStep
        step={step}
        account={account}
        onAdjust={() =>
          setStep({
            kind: 'wizard',
            file: step.file,
            grid: step.grid,
            initial: step.mapping,
            importId: step.importId,
          })
        }
        onDone={(r) => setStep({ kind: 'done', importId: step.importId, ...r })}
      />
    );
  }

  if (step.kind === 'done') {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <CheckCircle2 aria-hidden className="size-12 text-income" />
        <h2 className="text-lg font-semibold">
          Imported {step.inserted} transaction{step.inserted === 1 ? '' : 's'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {step.skipped > 0 && `${step.skipped} already in Kharcha were skipped. `}
          {step.transfers > 0 && `${step.transfers} marked as transfers.`}
        </p>
        <div className="grid w-full grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setStep({ kind: 'select' })}>
            Import another
          </Button>
          <Link
            to={`/transactions?importId=${step.importId}`}
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
        Download a statement (CSV, XLS or XLSX) from net banking and import it. Duplicates are
        skipped automatically.
      </p>
      <Field label="Account" htmlFor="import-account">
        <Select
          id="import-account"
          value={account?.id ?? ''}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {active.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <label
        htmlFor="statement-file"
        className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-center hover:bg-muted"
      >
        <Upload aria-hidden className="size-8 text-primary" />
        <span className="text-sm font-medium">Choose statement file</span>
        <span className="text-xs text-muted-foreground">
          HDFC, ICICI, SBI, Axis, Kotak recognised automatically · up to 5 MB
        </span>
      </label>
      <input
        id="statement-file"
        type="file"
        accept=".csv,.txt,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void onFile(f);
        }}
      />
      <Link to="/more/imports" className="min-h-11 text-center text-sm text-primary">
        Import history
      </Link>
    </div>
  );
}

const KIND_LABEL = {
  self_transfer: 'Transfer between your accounts',
  cc_bill_payment: 'Credit card bill payment',
};

function PreviewStep({
  step,
  account,
  onAdjust,
  onDone,
}: {
  step: Extract<Step, { kind: 'preview' }>;
  account: AccountDto | undefined;
  onAdjust: () => void;
  onDone: (r: { inserted: number; skipped: number; transfers: number }) => void;
}) {
  const commit = useCommitImport();
  const { preview } = step;
  const transfers = preview.rows.filter((r) => r.transfer && r.status !== 'duplicate');
  const near = preview.rows.filter((r) => r.status === 'near_duplicate');
  const fresh = preview.rows.filter((r) => r.status === 'new');
  const dupes = preview.rows.filter((r) => r.status === 'duplicate');
  const [accept, setAccept] = useState(
    () => new Set(transfers.filter((r) => r.transfer?.confidence === 'high').map((r) => r.index)),
  );
  const [include, setInclude] = useState(() => new Set<number>());
  const [showAll, setShowAll] = useState(false);
  const toImport = fresh.length + include.size;
  const net = useMemo(
    () =>
      fresh.reduce((acc, r) => acc + (r.direction === 'in' ? r.amountPaise : -r.amountPaise), 0),
    [fresh],
  );

  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, i: number) => {
    const next = new Set(set);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setter(next);
  };

  async function confirm() {
    try {
      const r = await commit.mutateAsync({
        importId: step.importId,
        body: { includeNearDuplicates: [...include], acceptTransfers: [...accept] },
      });
      toast.success(`Imported ${r.inserted} transactions`);
      onDone({ inserted: r.inserted, skipped: r.skippedDuplicates, transfers: r.transfersLinked });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{step.file.name}</p>
          <p className="text-xs text-muted-foreground">
            {step.profileLabel} → {account?.name}
          </p>
        </div>
        <Button variant="outline" onClick={onAdjust} className="shrink-0">
          Adjust columns
        </Button>
      </div>

      {step.duplicateOf && (
        <p
          role="alert"
          className="flex gap-2 rounded-lg bg-accent p-3 text-sm text-accent-foreground"
        >
          <AlertTriangle aria-hidden className="size-5 shrink-0" />
          You already imported this exact file
          {step.duplicateOf.committedAt
            ? ` on ${new Date(step.duplicateOf.committedAt).toLocaleDateString('en-IN')}`
            : ''}
          . Duplicates will be skipped.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 text-sm" aria-label="Summary">
        <Stat label="New" value={preview.summary.new} tone="text-income" />
        <Stat label="Already imported" value={preview.summary.duplicate} />
        <Stat
          label="Possible duplicates"
          value={preview.summary.nearDuplicate}
          tone={preview.summary.nearDuplicate ? 'text-expense' : undefined}
        />
        <Stat
          label="Unreadable rows"
          value={step.parseErrors.length}
          tone={step.parseErrors.length ? 'text-expense' : undefined}
        />
      </div>

      {preview.reconciliation && (
        <p
          role="status"
          className={cn(
            'rounded-lg p-3 text-sm',
            preview.reconciliation.matches
              ? 'bg-accent text-accent-foreground'
              : 'border border-expense/40 text-foreground',
          )}
        >
          {preview.reconciliation.matches ? (
            <>
              Balance after import matches the statement:{' '}
              <Money paise={preview.reconciliation.statementClosingPaise} />
            </>
          ) : (
            <>
              Statement closing balance is{' '}
              <Money paise={preview.reconciliation.statementClosingPaise} />, but Kharcha will show{' '}
              <Money paise={preview.reconciliation.projectedBalancePaise} /> (difference{' '}
              <Money
                paise={Math.abs(
                  preview.reconciliation.statementClosingPaise -
                    preview.reconciliation.projectedBalancePaise,
                )}
              />
              ). Check the account's opening balance and date.
            </>
          )}
        </p>
      )}

      {transfers.length > 0 && (
        <Section
          title={`Transfers detected (${transfers.length})`}
          hint="Ticked rows won't count as spending or income."
        >
          {transfers.map((r) => (
            <CheckRow
              key={r.index}
              row={r}
              checked={accept.has(r.index)}
              onToggle={() => toggle(accept, setAccept, r.index)}
              label={`Mark row ${r.sourceRow} as transfer`}
              detail={
                <span className="flex items-center gap-1 text-primary">
                  <ArrowLeftRight aria-hidden className="size-3" />
                  {r.transfer ? KIND_LABEL[r.transfer.kind] : ''}
                  {r.transfer?.counterpartTxnId ? ' · matched' : ''} — {r.transfer?.reason}
                </span>
              }
            />
          ))}
        </Section>
      )}

      {near.length > 0 && (
        <Section
          title={`Possible duplicates (${near.length})`}
          hint="Skipped unless you tick them."
        >
          {near.map((r) => (
            <CheckRow
              key={r.index}
              row={r}
              checked={include.has(r.index)}
              onToggle={() => toggle(include, setInclude, r.index)}
              label={`Import row ${r.sourceRow} anyway`}
              detail={
                r.match && (
                  <span>
                    Looks like {r.match.txnDate} · {r.match.narration ?? 'manual entry'} ·{' '}
                    {formatINR(r.match.amountPaise)}
                  </span>
                )
              }
            />
          ))}
        </Section>
      )}

      <Section
        title={`New transactions (${fresh.length})`}
        hint={fresh.length ? `Net ${net >= 0 ? '+' : '−'}${formatINR(Math.abs(net))}` : undefined}
      >
        {(showAll ? fresh : fresh.slice(0, 30)).map((r) => (
          <PreviewLine key={r.index} row={r} />
        ))}
        {fresh.length > 30 && !showAll && (
          <button
            type="button"
            className="min-h-11 text-sm text-primary"
            onClick={() => setShowAll(true)}
          >
            Show all {fresh.length}
          </button>
        )}
      </Section>

      {dupes.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-muted-foreground">
            Already imported ({dupes.length}) — will be skipped
          </summary>
          <Card className="p-2">
            {dupes.map((r) => (
              <PreviewLine key={r.index} row={r} />
            ))}
          </Card>
        </details>
      )}

      {step.parseErrors.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-expense">
            Rows we couldn't read ({step.parseErrors.length})
          </summary>
          <ul className="text-xs text-muted-foreground">
            {step.parseErrors.map((e) => (
              <li key={e.sourceRow}>
                Row {e.sourceRow}: {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="sticky bottom-20 z-10 -mx-4 border-t border-border bg-background px-4 pt-3 pb-2">
        <Button
          className="w-full"
          disabled={toImport === 0 || commit.isPending}
          onClick={() => void confirm()}
        >
          {toImport === 0
            ? 'Nothing new to import'
            : `Import ${toImport} transaction${toImport === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string | undefined }) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-xl font-semibold tabular-nums', tone)}>{value}</p>
    </Card>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      <Card className="divide-y divide-border p-1">{children}</Card>
    </section>
  );
}

function PreviewLine({ row }: { row: PreviewRow }) {
  return (
    <div className="flex items-center gap-2 px-2 py-2 text-sm">
      <span className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">
        {row.txnDate}
      </span>
      <span className="min-w-0 flex-1 truncate">{row.narration}</span>
      <Money
        paise={row.amountPaise}
        direction={row.direction}
        className="shrink-0 text-xs font-medium"
      />
    </div>
  );
}

function CheckRow({
  row,
  checked,
  onToggle,
  label,
  detail,
}: {
  row: PreviewRow;
  checked: boolean;
  onToggle: () => void;
  label: string;
  detail: React.ReactNode;
}) {
  return (
    <label className="flex min-h-14 cursor-pointer items-start gap-3 px-2 py-2">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={onToggle}
        className="mt-1 size-5 shrink-0 accent-[var(--primary)]"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
        <span className="flex justify-between gap-2">
          <span className="truncate">
            {row.txnDate} · {row.narration}
          </span>
          <Money
            paise={row.amountPaise}
            direction={row.direction}
            className="shrink-0 text-xs font-medium"
          />
        </span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}
