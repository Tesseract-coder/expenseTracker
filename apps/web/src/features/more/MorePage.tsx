import {
  ChevronRight,
  ClipboardCheck,
  DatabaseBackup,
  FileUp,
  History,
  Inbox,
  MessageSquareText,
  Shapes,
  Users,
  Wallet,
  Wand2,
} from 'lucide-react';
import { Link } from 'react-router';
import {
  useCategories,
  useHealth,
  useInboxCount,
  useMe,
  useReviewCount,
  useSettings,
  useUpdateSettings,
} from '@/app/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePreferences, type ThemePref } from '@/lib/preferences';
import { cn } from '@/lib/utils';

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function MorePage() {
  const { theme, setTheme, privacy, setPrivacy } = usePreferences();
  const health = useHealth();
  const me = useMe();
  const categories = useCategories();
  const inboxCount = useInboxCount();
  const reviewCount = useReviewCount();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <ul className="divide-y divide-border">
          {[
            { to: '/inbox', label: 'Needs labelling', icon: Inbox, badge: inboxCount.data },
            ...(reviewCount.data
              ? [
                  {
                    to: '/transactions?status=needs_review',
                    label: 'Needs review',
                    icon: ClipboardCheck,
                    badge: reviewCount.data,
                  },
                ]
              : []),
            { to: '/more/accounts', label: 'Accounts', icon: Wallet },
            { to: '/more/categories', label: 'Categories', icon: Shapes },
            { to: '/more/rules', label: 'Rules & learned labels', icon: Wand2 },
            { to: '/more/payees', label: 'Payees', icon: Users },
            { to: '/import', label: 'Import statement', icon: FileUp },
            { to: '/import/sms', label: 'Paste bank SMS', icon: MessageSquareText },
            { to: '/more/imports', label: 'Import history', icon: History },
            { to: '/more/backup', label: 'Backup & restore', icon: DatabaseBackup },
          ].map(({ to, label, icon: Icon, badge }) => (
            <li key={to}>
              <Link to={to} className="flex min-h-14 items-center gap-3 px-4 text-sm font-medium">
                <Icon aria-hidden className="size-5 text-muted-foreground" />
                <span className="flex-1">{label}</span>
                {badge ? (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                    {badge}
                  </span>
                ) : null}
                <ChevronRight aria-hidden className="size-5 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle id="theme-label">Theme</CardTitle>
        </CardHeader>
        <CardContent>
          <div role="radiogroup" aria-labelledby="theme-label" className="grid grid-cols-3 gap-2">
            {THEMES.map((t) => (
              <button
                key={t.value}
                role="radio"
                aria-checked={theme === t.value}
                onClick={() => setTheme(t.value)}
                className={cn(
                  'min-h-11 rounded-md border text-sm font-medium',
                  theme === t.value
                    ? 'border-primary bg-accent text-accent-foreground'
                    : 'border-border',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <label className="flex min-h-11 items-center justify-between gap-4 text-sm font-medium">
            Hide amounts (privacy mode)
            <input
              type="checkbox"
              className="size-5 accent-[var(--primary)]"
              checked={privacy}
              onChange={(e) => setPrivacy(e.target.checked)}
            />
          </label>
        </CardContent>
      </Card>

      {me.data?.features.ai && (
        <Card>
          <CardContent className="flex flex-col gap-1 pt-4">
            <label className="flex min-h-11 items-center justify-between gap-4 text-sm font-medium">
              Apply confident AI suggestions automatically
              <input
                type="checkbox"
                className="size-5 accent-[var(--primary)]"
                checked={settings.data?.aiAutoApply ?? false}
                disabled={!settings.data || updateSettings.isPending}
                onChange={(e) => updateSettings.mutate({ aiAutoApply: e.target.checked })}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Only suggestions the model is at least 90% sure of, marked "AI" and undoable. Your
              rules, labels and manual choices always win.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {health.isPending ? (
            <Skeleton className="h-4 w-48" />
          ) : health.isError ? (
            <p className="text-expense">API unreachable</p>
          ) : (
            <p>
              API {health.data.status} · DB {health.data.db} · {health.data.env}{' '}
              {health.data.version}
            </p>
          )}
          {me.data && <p className="text-muted-foreground">Signed in as {me.data.email}</p>}
          {categories.data && (
            <p className="text-muted-foreground">{categories.data.length} categories</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
