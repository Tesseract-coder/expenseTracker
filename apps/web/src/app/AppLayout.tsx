import { Eye, EyeOff } from 'lucide-react';
import { Outlet, useMatches } from 'react-router';
import { Button } from '@/components/ui/button';
import { usePreferences } from '@/lib/preferences';
import { TransactionSheetProvider } from '@/features/transactions/TransactionSheet';
import { BottomNav } from './BottomNav';

interface RouteHandle {
  title?: string;
}

export function AppLayout() {
  const { privacy, setPrivacy } = usePreferences();
  const matches = useMatches();
  const title =
    [...matches]
      .reverse()
      .map((m) => (m.handle as RouteHandle | undefined)?.title)
      .find(Boolean) ?? 'Kharcha';

  return (
    <TransactionSheetProvider>
      <div className="mx-auto flex min-h-full max-w-lg flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
          <h1 className="py-3 text-lg font-semibold">{title}</h1>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPrivacy(!privacy)}
            aria-pressed={privacy}
            aria-label={privacy ? 'Show amounts' : 'Hide amounts'}
          >
            {privacy ? (
              <EyeOff aria-hidden className="size-5" />
            ) : (
              <Eye aria-hidden className="size-5" />
            )}
          </Button>
        </header>
        <main className="flex-1 px-4 pt-4 pb-24">
          <Outlet />
        </main>
        <BottomNav />
      </div>
    </TransactionSheetProvider>
  );
}
