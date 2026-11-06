import type { ReactNode } from 'react';
import { Drawer } from 'vaul';
import { cn } from '@/lib/utils';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Nested sheets (e.g. a picker opened from a form) need this for correct stacking. */
  nested?: boolean;
  className?: string;
}

/** Mobile bottom sheet (shadcn Drawer pattern on vaul): focus-trapped, swipe to dismiss. */
export default function VaulSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  nested,
  className,
}: SheetProps) {
  const Root = nested ? Drawer.NestedRoot : Drawer.Root;
  return (
    <Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Drawer.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] max-w-lg flex-col rounded-t-2xl border border-border bg-card text-card-foreground outline-none',
            className,
          )}
        >
          <div aria-hidden className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted" />
          <div className="px-4 pt-3 pb-2">
            <Drawer.Title className="text-base font-semibold">{title}</Drawer.Title>
            <Drawer.Description
              className={description ? 'text-sm text-muted-foreground' : 'sr-only'}
            >
              {description ?? title}
            </Drawer.Description>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
          {footer && (
            <div className="border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Root>
  );
}
