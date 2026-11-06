import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * Renders `children` once the placeholder comes within `margin` of the viewport. Used for
 * below-the-fold charts, so the first paint doesn't pay for Recharts (Phase 6 Lighthouse pass).
 */
export function WhenVisible({
  children,
  placeholder,
  margin = '200px',
}: {
  children: ReactNode;
  placeholder: ReactNode;
  margin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (visible || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, margin]);
  return visible ? children : <div ref={ref}>{placeholder}</div>;
}
