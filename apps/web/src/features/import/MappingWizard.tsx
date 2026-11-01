import { useMemo, useState } from 'react';
import {
  type ColumnMapping,
  type Grid,
  columnMappingSchema,
  detectDateOrder,
  formatINR,
  parseGrid,
} from '@kharcha/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Switch } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { columnLetter } from './readStatement';

type AmountKind = ColumnMapping['amount']['kind'];

const NONE = '';

function emptyMapping(): ColumnMapping {
  return {
    headerRow: 0,
    dateCol: 0,
    valueDateCol: null,
    narrationCols: [1],
    refCol: null,
    balanceCol: null,
    amount: { kind: 'debit_credit', debitCol: 2, creditCol: 3 },
    dateOrder: 'dmy',
  };
}

export interface WizardResult {
  mapping: ColumnMapping;
  remember: { name: string } | null;
}

/**
 * Generic column-mapping wizard for statements no built-in profile recognises (or to correct one).
 * Live-previews the parse so the user can see the effect of each choice.
 */
export function MappingWizard({
  grid,
  initial,
  defaultProfileName,
  onCancel,
  onConfirm,
}: {
  grid: Grid;
  initial: ColumnMapping | null;
  defaultProfileName: string;
  onCancel: () => void;
  onConfirm: (r: WizardResult) => void;
}) {
  const [m, setM] = useState<ColumnMapping>(initial ?? emptyMapping());
  const [remember, setRemember] = useState(true);
  const [name, setName] = useState(defaultProfileName);

  const header = grid[m.headerRow] ?? [];
  const width = Math.max(header.length, grid[m.headerRow + 1]?.length ?? 0);
  const columns = Array.from({ length: width }, (_, i) => ({
    value: String(i),
    label: `${columnLetter(i)} · ${header[i]?.trim() || '(blank)'}`,
  }));

  const valid = columnMappingSchema.safeParse(m).success;
  const result = useMemo(() => (valid ? parseGrid(grid, m) : null), [grid, m, valid]);

  const set = (patch: Partial<ColumnMapping>) => setM((prev) => ({ ...prev, ...patch }));
  const colSelect = (
    label: string,
    value: number | null,
    onChange: (v: number | null) => void,
    optional = false,
  ) => (
    <Field label={label} htmlFor={`col-${label}`}>
      <Select
        id={`col-${label}`}
        value={value === null ? NONE : String(value)}
        onChange={(e) => onChange(e.target.value === NONE ? null : Number(e.target.value))}
      >
        {optional && <option value={NONE}>— none —</option>}
        {columns.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>
    </Field>
  );

  function setAmountKind(kind: AmountKind) {
    const a = m.amount;
    const firstCol = a.kind === 'debit_credit' ? a.debitCol : a.amountCol;
    if (kind === 'debit_credit')
      set({ amount: { kind, debitCol: firstCol, creditCol: firstCol + 1 } });
    else if (kind === 'amount_with_type')
      set({ amount: { kind, amountCol: firstCol, typeCol: null, defaultDirection: 'out' } });
    else set({ amount: { kind, amountCol: firstCol, negativeIs: 'out' } });
  }

  function setHeaderRow(row: number) {
    const samples = grid.slice(row + 1, row + 30).map((r) => r[m.dateCol] ?? '');
    set({ headerRow: row, dateOrder: detectDateOrder(samples) });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Tell us which columns hold what. The preview below updates as you go.
      </p>

      <div className="max-w-full overflow-x-auto rounded-lg border border-border">
        <table className="text-xs">
          <thead>
            <tr className="bg-muted">
              <th className="px-2 py-1 text-left">#</th>
              {Array.from({ length: width }, (_, i) => (
                <th key={i} className="px-2 py-1 text-left font-semibold">
                  {columnLetter(i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.slice(Math.max(0, m.headerRow - 2), m.headerRow + 6).map((row, i) => {
              const idx = Math.max(0, m.headerRow - 2) + i;
              return (
                <tr
                  key={idx}
                  className={cn(
                    'border-t border-border',
                    idx === m.headerRow && 'bg-accent font-semibold',
                  )}
                >
                  <td className="px-2 py-1 text-muted-foreground">{idx + 1}</td>
                  {Array.from({ length: width }, (_, c) => (
                    <td key={c} className="max-w-40 truncate px-2 py-1 whitespace-nowrap">
                      {row[c]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Field label="Header row" htmlFor="header-row">
        <Select
          id="header-row"
          value={m.headerRow}
          onChange={(e) => setHeaderRow(Number(e.target.value))}
        >
          {grid.slice(0, 40).map((row, i) => (
            <option key={i} value={i}>
              Row {i + 1}: {row.filter(Boolean).slice(0, 3).join(' | ').slice(0, 50) || '(empty)'}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        {colSelect('Date', m.dateCol, (v) => set({ dateCol: v ?? 0 }))}
        <Field label="Date format" htmlFor="date-order">
          <Select
            id="date-order"
            value={m.dateOrder}
            onChange={(e) => set({ dateOrder: e.target.value as ColumnMapping['dateOrder'] })}
          >
            <option value="dmy">DD/MM/YYYY</option>
            <option value="mdy">MM/DD/YYYY</option>
            <option value="ymd">YYYY/MM/DD</option>
          </Select>
        </Field>
        {colSelect('Description', m.narrationCols[0] ?? 0, (v) =>
          set({ narrationCols: [v ?? 0, ...m.narrationCols.slice(1)] }),
        )}
        {colSelect(
          'More description',
          m.narrationCols[1] ?? null,
          (v) =>
            set({
              narrationCols: v === null ? [m.narrationCols[0] ?? 0] : [m.narrationCols[0] ?? 0, v],
            }),
          true,
        )}
        {colSelect('Reference no.', m.refCol, (v) => set({ refCol: v }), true)}
        {colSelect('Balance', m.balanceCol, (v) => set({ balanceCol: v }), true)}
      </div>

      <Field label="How are amounts shown?" htmlFor="amount-kind">
        <Select
          id="amount-kind"
          value={m.amount.kind}
          onChange={(e) => setAmountKind(e.target.value as AmountKind)}
        >
          <option value="debit_credit">Separate withdrawal and deposit columns</option>
          <option value="amount_with_type">One amount column (+ Dr/Cr column or suffix)</option>
          <option value="signed">One column, negative = one direction</option>
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        {m.amount.kind === 'debit_credit' && (
          <>
            {colSelect(
              'Withdrawal (out)',
              m.amount.debitCol,
              (v) =>
                m.amount.kind === 'debit_credit' &&
                set({ amount: { ...m.amount, debitCol: v ?? 0 } }),
            )}
            {colSelect(
              'Deposit (in)',
              m.amount.creditCol,
              (v) =>
                m.amount.kind === 'debit_credit' &&
                set({ amount: { ...m.amount, creditCol: v ?? 0 } }),
            )}
          </>
        )}
        {m.amount.kind === 'amount_with_type' && (
          <>
            {colSelect(
              'Amount',
              m.amount.amountCol,
              (v) =>
                m.amount.kind === 'amount_with_type' &&
                set({ amount: { ...m.amount, amountCol: v ?? 0 } }),
            )}
            {colSelect(
              'Dr/Cr column',
              m.amount.typeCol,
              (v) =>
                m.amount.kind === 'amount_with_type' &&
                set({ amount: { ...m.amount, typeCol: v } }),
              true,
            )}
            <Field label="If no Dr/Cr marker" htmlFor="default-dir" className="col-span-2">
              <Select
                id="default-dir"
                value={m.amount.defaultDirection}
                onChange={(e) =>
                  m.amount.kind === 'amount_with_type' &&
                  set({ amount: { ...m.amount, defaultDirection: e.target.value as 'in' | 'out' } })
                }
              >
                <option value="out">Treat as money out (spend)</option>
                <option value="in">Treat as money in</option>
              </Select>
            </Field>
          </>
        )}
        {m.amount.kind === 'signed' && (
          <>
            {colSelect(
              'Amount',
              m.amount.amountCol,
              (v) =>
                m.amount.kind === 'signed' && set({ amount: { ...m.amount, amountCol: v ?? 0 } }),
            )}
            <Field label="Negative means" htmlFor="neg-is">
              <Select
                id="neg-is"
                value={m.amount.negativeIs}
                onChange={(e) =>
                  m.amount.kind === 'signed' &&
                  set({ amount: { ...m.amount, negativeIs: e.target.value as 'in' | 'out' } })
                }
              >
                <option value="out">Money out</option>
                <option value="in">Money in</option>
              </Select>
            </Field>
          </>
        )}
      </div>

      <section aria-label="Parse preview" className="rounded-lg border border-border p-3">
        {result ? (
          <>
            <p className="mb-2 text-sm font-medium">
              {result.rows.length} transactions found
              {result.errors.length > 0 && (
                <span className="text-expense"> · {result.errors.length} rows unreadable</span>
              )}
            </p>
            <ul className="flex flex-col gap-1 text-xs">
              {result.rows.slice(0, 5).map((r) => (
                <li key={r.sourceRow} className="flex justify-between gap-2">
                  <span className="truncate">
                    {r.txnDate} · {r.narration}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 tabular-nums',
                      r.direction === 'in' ? 'text-income' : 'text-expense',
                    )}
                  >
                    {r.direction === 'in' ? '+' : '−'}
                    {formatINR(r.amountPaise)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Pick the columns to see a preview.</p>
        )}
      </section>

      <Switch
        label="Remember these columns for this account"
        checked={remember}
        onCheckedChange={setRemember}
      />
      {remember && (
        <Field label="Profile name" htmlFor="profile-name">
          <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      )}

      <div className="sticky bottom-0 -mx-4 grid grid-cols-2 gap-2 border-t border-border bg-background px-4 pt-3 pb-1">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={!result || result.rows.length === 0}
          onClick={() =>
            onConfirm({
              mapping: m,
              remember: remember && name.trim() ? { name: name.trim() } : null,
            })
          }
        >
          Use these columns
        </Button>
      </div>
    </div>
  );
}
