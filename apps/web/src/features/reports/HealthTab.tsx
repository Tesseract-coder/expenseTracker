import { Lightbulb, SlidersHorizontal, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { parseRupeesToPaise, type HealthScoreResponse, type SettingsDto } from '@kharcha/shared';
import { useHealthScore, useSettings, useUpdateSettings } from '@/app/queries';
import { StatusBadge, type Severity } from '@/components/charts/Figures';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { periodLabel, usePeriod } from '@/lib/period';
import { cn } from '@/lib/utils';

const BAND: Record<
  NonNullable<HealthScoreResponse['band']>,
  { label: string; severity: Severity }
> = {
  excellent: { label: 'Excellent', severity: 'good' },
  good: { label: 'Good', severity: 'good' },
  needs_attention: { label: 'Needs attention', severity: 'serious' },
  off_track: { label: 'Off-track', severity: 'critical' },
};

/** "Am I doing good or bad?" — explainable 0–100 score with components, drivers and suggestions. */
export function HealthTab() {
  const period = usePeriod();
  const kind = period.kind === 'year' ? 'year' : 'month';
  const date = period.range.to;
  const health = useHealthScore({
    period: kind,
    date,
    accountIds: period.accountIds.length ? period.accountIds : undefined,
  });
  const [targetsOpen, setTargetsOpen] = useState(false);
  const h = health.data;

  return (
    <div className={cn('flex flex-col gap-3', health.isPlaceholderData && 'opacity-60')}>
      {!h ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Card className="flex flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm text-muted-foreground">
                  Financial health ·{' '}
                  {periodLabel(kind, { from: h.from, to: h.to }, period.yearMode)}
                </p>
                <p className="text-5xl font-semibold">
                  {h.score ?? '—'}
                  <span className="text-lg font-normal text-muted-foreground">/100</span>
                </p>
              </div>
              <Button variant="outline" onClick={() => setTargetsOpen(true)} data-print-hide>
                <SlidersHorizontal aria-hidden className="size-4" /> Targets
              </Button>
            </div>
            {h.band ? (
              <StatusBadge status={BAND[h.band].severity} label={BAND[h.band].label} />
            ) : (
              <StatusBadge status="na" label="Add income to get a score" />
            )}
            <dl className="mt-1 grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Income</dt>
                <dd>
                  <Money paise={h.totals.income} className="font-medium" />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Spend</dt>
                <dd>
                  <Money paise={h.totals.spend} className="font-medium" />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Saved</dt>
                <dd>
                  <Money paise={h.totals.savings} className="font-medium" />
                </dd>
              </div>
            </dl>
          </Card>

          {h.drivers.length > 0 && (
            <Card className="flex flex-col gap-2 p-4">
              <h2 className="text-sm font-semibold">Biggest drivers</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {h.drivers.map((d) => (
                  <li key={d.key} className="flex items-start gap-2">
                    {d.impact === 'positive' ? (
                      <ThumbsUp
                        aria-label="Helping"
                        className="mt-0.5 size-4 shrink-0 text-status-good"
                      />
                    ) : (
                      <ThumbsDown
                        aria-label="Hurting"
                        className="mt-0.5 size-4 shrink-0 text-status-critical"
                      />
                    )}
                    <span>{d.text}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {h.suggestions.length > 0 && (
            <Card className="flex flex-col gap-2 p-4">
              <h2 className="text-sm font-semibold">Suggestions</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {h.suggestions.map((s) => (
                  <li key={s} className="flex items-start gap-2">
                    <Lightbulb aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span data-money>{s}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="px-4">
            <ul className="divide-y divide-border">
              {h.components.map((c) => (
                <li key={c.key} className="flex flex-col gap-1 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{c.label}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="flex justify-between gap-2 text-xs">
                    <span data-money className="font-medium tabular-nums">
                      {c.value}
                    </span>
                    <span className="text-muted-foreground">Target {c.target}</span>
                  </div>
                  <p className="text-xs text-muted-foreground" data-money>
                    {c.verdict}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
          <p className="text-xs text-muted-foreground">
            The score is a weighted average of the components with enough data (savings 30%,
            investing, split, budgets 15% each; trend, lifestyle creep, emergency fund 10% each).
            Transfers between your accounts never count.
          </p>
        </>
      )}
      {targetsOpen && <TargetsSheet onClose={() => setTargetsOpen(false)} />}
    </div>
  );
}

const pctIn = (x: number) => String(Math.round(x * 100));

function TargetsSheet({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const update = useUpdateSettings();
  const s = settings.data;
  const [form, setForm] = useState(() => ({
    yearMode: s?.yearMode ?? 'calendar',
    savingsRate: pctIn(s?.targets.savingsRate ?? 0.2),
    investmentRate: pctIn(s?.targets.investmentRate ?? 0.15),
    needs: pctIn(s?.targets.needs ?? 0.5),
    wants: pctIn(s?.targets.wants ?? 0.3),
    savings: pctIn(s?.targets.savings ?? 0.2),
    emergencyMonths: String(s?.targets.emergencyMonths ?? 6),
    fund: s?.emergencyFundPaise != null ? String(s.emergencyFundPaise / 100) : '',
  }));
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });
  const ratio = (v: string) => Math.min(1, Math.max(0, Number(v) / 100));

  const submit = () => {
    const fund = form.fund.trim() ? parseRupeesToPaise(form.fund) : null;
    if (form.fund.trim() && (fund === null || fund < 0))
      return toast.error('Enter a valid emergency fund amount');
    update.mutate(
      {
        yearMode: form.yearMode as SettingsDto['yearMode'],
        emergencyFundPaise: fund,
        targets: {
          savingsRate: ratio(form.savingsRate),
          investmentRate: ratio(form.investmentRate),
          needs: ratio(form.needs),
          wants: ratio(form.wants),
          savings: ratio(form.savings),
          emergencyMonths: Math.min(36, Math.max(1, Math.round(Number(form.emergencyMonths) || 6))),
        },
      },
      {
        onSuccess: () => {
          toast.success('Targets saved');
          onClose();
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  const num = (id: keyof typeof form, label: string) => (
    <Field label={label} htmlFor={`t-${id}`}>
      <Input id={`t-${id}`} inputMode="decimal" value={form[id]} onChange={set(id)} />
    </Field>
  );

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Targets & settings"
      footer={
        <Button className="w-full" disabled={update.isPending} onClick={submit}>
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          role="radiogroup"
          aria-label="Year runs"
          className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
        >
          {(['calendar', 'fy'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={form.yearMode === m}
              onClick={() => setForm({ ...form, yearMode: m })}
              className={cn(
                'min-h-11 rounded-md text-sm font-medium',
                form.yearMode === m ? 'bg-card shadow' : 'text-muted-foreground',
              )}
            >
              {m === 'calendar' ? 'Calendar year' : 'Financial year (Apr–Mar)'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {num('savingsRate', 'Savings rate %')}
          {num('investmentRate', 'Investment rate %')}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {num('needs', 'Needs %')}
          {num('wants', 'Wants %')}
          {num('savings', 'Savings %')}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {num('fund', 'Emergency fund (₹)')}
          {num('emergencyMonths', 'Target months')}
        </div>
      </div>
    </Sheet>
  );
}
