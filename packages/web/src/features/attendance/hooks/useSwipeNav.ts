import { type RefObject, useEffect, useRef } from 'react';

/**
 * 左右のスワイプ(GAS版 bindCalSwipeNavTo_)。縦スクロールと見分けるため、動き始めの向きが
 * 横のときだけスワイプとして扱い(そのときだけ preventDefault)、50px以上動いたら onSwipe を呼ぶ。
 * 左へ動かす = 次(+1)、右へ動かす = 前(-1)。
 */
export function useSwipeNav(ref: RefObject<HTMLElement | null>, onSwipe: (direction: 1 | -1) => void) {
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let horizontal: boolean | null = null;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length !== 1 || !t) return;
      startX = t.clientX;
      startY = t.clientY;
      dragging = true;
      horizontal = null;
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!dragging || e.touches.length !== 1 || !t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (horizontal === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        horizontal = Math.abs(dx) > Math.abs(dy);
      }
      if (horizontal) e.preventDefault();
    };
    const onEnd = (e: TouchEvent) => {
      if (!dragging) return;
      dragging = false;
      const t = e.changedTouches[0];
      if (!horizontal || !t) return;
      const dx = t.clientX - startX;
      if (Math.abs(dx) < 50) return;
      onSwipeRef.current(dx < 0 ? 1 : -1);
    };
    const onCancel = () => {
      dragging = false;
      horizontal = null;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onCancel);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  }, [ref]);
}
