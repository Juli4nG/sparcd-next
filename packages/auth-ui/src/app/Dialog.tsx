import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openDialogs = 0;

/** True while any Dialog is open, wherever it was opened: a screen's shortcuts wait for it. */
export const dialogOpen = () => openDialogs > 0;

/** A modal card: keeps Tab inside, closes on Escape or a click outside, and gives focus back. */
export function Dialog({ label, onClose, children, wide }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    openDialogs++;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const [first, last] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      openDialogs--;
      window.removeEventListener('keydown', onKey, true);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[200] grid place-items-center bg-ink/40 p-6" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? 'max-w-[720px]' : 'max-w-[560px]'} max-h-[90dvh] overflow-y-auto bg-paper border border-rule shadow-xl`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function DialogHeader({ title, onClose }: { title: ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3">
      <h2 className="font-display text-body font-[600] text-ink min-w-0">{title}</h2>
      <button
        onClick={onClose}
        className="shrink-0 w-11 h-11 grid place-items-center border border-rule text-small text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        aria-label="Close"
      >
        ✕
      </button>
    </div>
  );
}
