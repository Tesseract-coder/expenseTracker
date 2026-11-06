import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Pill toggle used for filters, accounts and categories. 44px tall tap target. */
export function Chip({
  selected,
  className,
  ...props
}: ComponentProps<'button'> & { selected?: boolean }) {
  return (
    <button
      type="button"
      // Tabs announce selection with aria-selected; aria-pressed isn't allowed on them.
      aria-pressed={props.role === 'tab' ? undefined : selected}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors',
        selected
          ? 'border-primary bg-accent text-accent-foreground'
          : 'border-border bg-card text-foreground hover:bg-muted',
        className,
      )}
      {...props}
    />
  );
}
