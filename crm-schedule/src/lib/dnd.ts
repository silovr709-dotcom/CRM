// Перетаскивание, которое работает и мышью, и пальцем: Pointer Events вместо
// HTML5 drag-and-drop. Элемент-цель помечается атрибутом data-drop="…".
import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface DragPayload {
  id: string;
  kind?: string;
  /** Что тащим — для подписи «отпустите над днём». */
  label?: string;
}

const DRAG_THRESHOLD = 6;

export function useDragDrop(onDrop: (payload: DragPayload, target: string) => void) {
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [over, setOver] = useState('');
  /** Время последнего завершённого перетаскивания — чтобы погасить клик. */
  const droppedAt = useRef(0);
  const state = useRef<{
    payload: DragPayload;
    startX: number;
    startY: number;
    active: boolean;
    pointerId: number;
  } | null>(null);

  const targetAt = (x: number, y: number): string => {
    const element = document.elementFromPoint(x, y);
    const drop = element?.closest('[data-drop]') as HTMLElement | null;
    return drop?.dataset.drop ?? '';
  };

  const bind = useCallback((payload: DragPayload) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      state.current = {
        payload,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        pointerId: event.pointerId,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const current = state.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const moved = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
      if (!current.active && moved < DRAG_THRESHOLD) return;
      if (!current.active) {
        current.active = true;
        setDrag(current.payload);
        document.body.classList.add('is-dragging');
      }
      const target = targetAt(event.clientX, event.clientY);
      setOver(target);
      // Не даём странице скроллиться, пока тащим карточку.
      if (event.cancelable) event.preventDefault();
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const current = state.current;
      state.current = null;
      document.body.classList.remove('is-dragging');
      setDrag(null);
      setOver('');
      if (!current?.active) return;
      droppedAt.current = Date.now();
      const target = targetAt(event.clientX, event.clientY);
      if (target) onDrop(current.payload, target);
    },
    // После переноса клик по карточке не должен открывать окно.
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
      if (Date.now() - droppedAt.current < 300) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onPointerCancel: () => {
      state.current = null;
      document.body.classList.remove('is-dragging');
      setDrag(null);
      setOver('');
    },
  }), [onDrop]);

  return { drag, over, bind };
}
