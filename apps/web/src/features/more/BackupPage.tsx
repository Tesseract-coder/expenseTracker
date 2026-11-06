import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type BackupFile,
  backupCounts,
  backupFileName,
  backupStatusResponseSchema,
  parseBackupFile,
} from '@kharcha/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet, errorMessage } from '@/lib/api';
import { exportBackup, restoreBackup } from './backup';

interface Running {
  done: number;
  total: number;
  label: string;
}

function download(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ProgressBar({ run }: { run: Running }) {
  const pct = Math.round((run.done / Math.max(1, run.total)) * 100);
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progress"
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-muted-foreground">{run.label}</p>
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString('en-IN');

export function BackupPage() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['backup-status'],
    queryFn: () => apiGet('/backup/status', backupStatusResponseSchema),
  });
  const [exporting, setExporting] = useState<Running | null>(null);
  const [restoring, setRestoring] = useState<Running | null>(null);
  const [picked, setPicked] = useState<{ name: string; file: BackupFile } | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [restored, setRestored] = useState<number | null>(null);

  async function onExport() {
    setExporting({ done: 0, total: 1, label: 'Starting…' });
    try {
      const file = await exportBackup((done, total, label) => setExporting({ done, total, label }));
      download(JSON.stringify(file), backupFileName(file.exportedAt));
      toast.success(`Backup saved: ${fmt(file.tables.transactions.length)} transactions`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(null);
    }
  }

  async function onPick(f: File) {
    setPicked(null);
    setConfirmed(false);
    setRestored(null);
    const parsed = parseBackupFile(await f.text());
    if (!parsed.ok) setPickError(parsed.error);
    else {
      setPickError(null);
      setPicked({ name: f.name, file: parsed.file });
    }
  }

  async function onRestore() {
    if (!picked) return;
    setRestoring({ done: 0, total: 1, label: 'Starting…' });
    try {
      const { counts } = await restoreBackup(picked.file, (done, total, label) =>
        setRestoring({ done, total, label }),
      );
      setRestored(counts.transactions);
      setPicked(null);
      setConfirmed(false);
      toast.success('Backup restored');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRestoring(null);
      // Everything on screen is stale after a restore (or a half-finished one).
      await qc.invalidateQueries();
    }
  }

  const counts = picked ? backupCounts(picked.file) : null;
  const busy = !!exporting || !!restoring;

  return (
    <div className="flex flex-col gap-4">
      {status.data?.restoreInProgress && !restoring && (
        <p
          role="alert"
          className="flex gap-2 rounded-lg border border-expense/40 p-3 text-sm text-foreground"
        >
          <AlertTriangle aria-hidden className="size-5 shrink-0 text-expense" />A restore
          didn&apos;t finish, so some data may be missing. Restore again from the same backup file.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Back up</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Saves everything (accounts, categories, transactions, rules, learned labels, budgets and
            settings) as one JSON file on this device. Keep it somewhere safe: it contains your
            financial history. Original statement files aren&apos;t included.
          </p>
          {exporting ? (
            <ProgressBar run={exporting} />
          ) : (
            <Button onClick={() => void onExport()} disabled={busy}>
              <Download aria-hidden className="size-4" />
              Download backup
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Restore</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Replaces <strong className="text-foreground">all</strong> data in Kharcha with a backup.
            Undo history is cleared.
          </p>
          {restored !== null && (
            <p role="status" className="flex items-center gap-2 text-sm">
              <CheckCircle2 aria-hidden className="size-5 text-income" />
              Restored {fmt(restored)} transactions.
            </p>
          )}
          {restoring ? (
            <ProgressBar run={restoring} />
          ) : (
            <>
              <label
                htmlFor="backup-file"
                className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
              >
                <Upload aria-hidden className="size-4" />
                Choose backup file
              </label>
              <input
                id="backup-file"
                type="file"
                accept=".json,application/json"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void onPick(f);
                }}
              />
            </>
          )}
          {pickError && (
            <p role="alert" className="text-sm text-expense">
              {pickError}
            </p>
          )}
          {picked && counts && !restoring && (
            <div className="flex flex-col gap-3 rounded-lg bg-muted p-3">
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium">{picked.name}</p>
                <p className="text-muted-foreground">
                  Made {new Date(picked.file.exportedAt).toLocaleString('en-IN')} ·{' '}
                  {fmt(counts.transactions)} transactions · {fmt(counts.accounts)} accounts ·{' '}
                  {fmt(counts.categories)} categories · {fmt(counts.rules)} rules
                </p>
              </div>
              <Button variant="outline" onClick={() => void onExport()} disabled={busy}>
                Back up current data first
              </Button>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--primary)]"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I understand this replaces all my current data
              </label>
              <Button disabled={!confirmed || busy} onClick={() => void onRestore()}>
                Replace my data with this backup
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
