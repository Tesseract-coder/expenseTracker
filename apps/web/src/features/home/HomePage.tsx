import { Inbox } from 'lucide-react';
import { useMe } from '@/app/queries';
import { EmptyState } from '@/components/EmptyState';
import { Money } from '@/components/Money';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const SUMMARY = [
  { title: 'Income', paise: 0 },
  { title: 'Spend', paise: 0 },
  { title: 'Invested', paise: 0 },
  { title: 'Net savings', paise: 0 },
];

export function HomePage() {
  const me = useMe();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {me.isPending ? (
          <Skeleton className="h-4 w-40" />
        ) : me.isError ? (
          'Could not load your profile'
        ) : (
          <>Signed in as {me.data.email}</>
        )}
      </p>
      <section aria-label="This month" className="grid grid-cols-2 gap-3">
        {SUMMARY.map((s) => (
          <Card key={s.title}>
            <CardHeader>
              <CardTitle>{s.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <Money paise={s.paise} className="text-xl font-semibold" />
            </CardContent>
          </Card>
        ))}
      </section>
      <EmptyState icon={Inbox} title="No transactions yet">
        Add accounts and transactions in the next phase. The dashboard fills in automatically.
      </EmptyState>
    </div>
  );
}
