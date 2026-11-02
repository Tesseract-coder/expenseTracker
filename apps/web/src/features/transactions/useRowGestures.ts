import { useRef, useState, type PointerEvent } from 'react';

const SWIPE_TRIGGER = 80;
const SWIPE_MAX = 120;
const LONG_PRESS_MS = 500;
const SLOP = 10;

/**
 * Swipe-left and long-press on a list row, without breaking vertical scrolling or taps.
 * The row needs `touch-action: pan-y` so the browser keeps vertical panning and hands
 * horizontal drags to us. Returns the current drag offset for rendering.
 */
export function useRowGestures({
  onSwipe,
  onLongPress,
  disabled,
}: {
  onSwipe?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const mode = useRef<'idle' | 'swipe' | 'scroll'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set when a gesture consumed the interaction, so the trailing click is ignored. */
  const consumed = useRef(false);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const reset = () => {
    clearTimer();
    start.current = null;
    mode.current = 'idle';
    setOffset(0);
  };

  const handlers = disabled
    ? {}
    : {
        onPointerDown: (e: PointerEvent) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          consumed.current = false;
          start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
          mode.current = 'idle';
          if (onLongPress) {
            timer.current = setTimeout(() => {
              consumed.current = true;
              timer.current = null;
              navigator.vibrate?.(15);
              onLongPress();
            }, LONG_PRESS_MS);
          }
        },
        onPointerMove: (e: PointerEvent) => {
          const s = start.current;
          if (!s || s.id !== e.pointerId) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (mode.current === 'idle') {
            if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
              mode.current = 'scroll';
              clearTimer();
            } else if (onSwipe && Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy)) {
              mode.current = 'swipe';
              clearTimer();
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
            } else if (Math.abs(dx) > SLOP || Math.abs(dy) > SLOP) {
              clearTimer();
            }
          }
          if (mode.current === 'swipe') setOffset(Math.max(-SWIPE_MAX, Math.min(0, dx)));
        },
        onPointerUp: () => {
          if (mode.current === 'swipe') {
            consumed.current = true;
            if (offset <= -SWIPE_TRIGGER) onSwipe?.();
          }
          reset();
        },
        onPointerCancel: reset,
        onContextMenu: (e: { preventDefault: () => void }) => {
          // Long-press on mobile opens the context menu; we use it for selection instead.
          if (onLongPress) e.preventDefault();
        },
      };

  /** Call from onClick: returns false if the click is the tail of a swipe/long-press. */
  const shouldHandleClick = () => {
    const ok = !consumed.current;
    consumed.current = false;
    return ok;
  };

  return { offset, handlers, shouldHandleClick, triggered: offset <= -SWIPE_TRIGGER };
}
