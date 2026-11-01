import { ChartPie, House, List, Menu, Plus, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';
import { cn } from '@/lib/utils';

interface Item {
  to: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean;
}

export const NAV_ITEMS: Item[] = [
  { to: '/', label: 'Home', icon: House },
  { to: '/transactions', label: 'Transactions', icon: List },
  { to: '/add', label: 'Add', icon: Plus, primary: true },
  { to: '/reports', label: 'Reports', icon: ChartPie },
  { to: '/more', label: 'More', icon: Menu },
];

export function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {NAV_ITEMS.map(({ to, label, icon: Icon, primary }) => (
          <li key={to}>
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
              {primary ? (
                <span className="-mt-5 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background">
                  <Icon aria-hidden className="size-6" />
                </span>
              ) : (
                <Icon aria-hidden className="size-5" />
              )}
              <span className={primary ? 'sr-only' : undefined}>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
