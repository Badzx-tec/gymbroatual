import { useEffect } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function useFocusTrap(ref, active) {
  useEffect(() => {
    if (!active || !ref.current) return undefined;

    const savedFocus = document.activeElement;
    const container = ref.current;

    const focusable = () => Array.from(container.querySelectorAll(FOCUSABLE));

    const initialFocus = focusable()[0];
    if (initialFocus) initialFocus.focus();

    const onKeyDown = (event) => {
      if (event.key !== 'Tab') return;
      const els = focusable();
      if (!els.length) { event.preventDefault(); return; }
      if (event.shiftKey) {
        if (document.activeElement === els[0]) {
          event.preventDefault();
          els.at(-1)?.focus();
        }
      } else {
        if (document.activeElement === els.at(-1)) {
          event.preventDefault();
          els[0]?.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const focusTarget = /** @type {HTMLElement | null} */ (savedFocus);
      if (focusTarget && typeof focusTarget.focus === 'function') {
        focusTarget.focus();
      }
    };
  }, [active, ref]);
}
