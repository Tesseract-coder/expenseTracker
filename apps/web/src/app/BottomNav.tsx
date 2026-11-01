import { ChartPie, House, List, Menu, Plus, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';
import { cn } from '@/lib/utils';
import { useTransactionSheet } from '@/features/transactions/TransactionSheet';

interface Item {
  to: string;
  label: string;
  icon: LucideIcon;
}

const LEFT: Item[] = [
  { to: '/', label: 'Home', icon: House },
  { to: '/transactions', label: 'Transactions', icon: List },
];
const RIGHT: Item[] = [
  { to: '/reports', label: 'Reports', icon: ChartPie },
  { to: '/more', label: 'More', icon: Menu },
];

function NavItem({ to, label, icon: Icon }: Item) {
  return (
    <li>
      <NavLink
        to={to}
        end={to === '/'}
        aria-label={label}
        className={({ isActive }) =>
          cn(
            'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
            isActive ? 'text-primary' : 'text-muted-foreground',
          )
        }
      >
        <Icon aria-hidden className="size-5" />
        <span>{label}</span>
      </NavLink>
    </li>
  );
}

export function BottomNav() {
  const { openAdd } = useTransactionSheet();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {LEFT.map((i) => (
          <NavItem key={i.to} {...i} />
        ))}
        <li className="flex justify-center">
          <button
            type="button"
            onClick={openAdd}
            aria-label="Add transaction"
            className="-mt-5 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background"
          >
            <Plus aria-hidden className="size-7" />
          </button>
        </li>
        {RIGHT.map((i) => (
          <NavItem key={i.to} {...i} />
        ))}
      </ul>
    </nav>
  );
}
