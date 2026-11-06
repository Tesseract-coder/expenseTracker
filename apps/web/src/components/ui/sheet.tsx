import { lazy, Suspense, useState } from 'react';
import type { SheetProps } from './sheet-impl';

const VaulSheet = lazy(() => import('./sheet-impl'));

/**
 * Mobile bottom sheet. vaul (+ Radix dialog) loads the first time any sheet opens, so pages that
 * merely contain a sheet don't ship it in their first load (Phase 6 Lighthouse pass). Once
 * opened, it stays mounted so the close animation runs.
 */
export function Sheet(props: SheetProps) {
  const [used, setUsed] = useState(props.open);
  if (props.open && !used) setUsed(true);
  if (!used) return null;
  return (
    <Suspense fallback={null}>
      <VaulSheet {...props} />
    </Suspense>
  );
}
