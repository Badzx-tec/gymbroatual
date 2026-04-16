import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

import IconButton from './IconButton';

export default function SidePanel({ open, onClose, title, description, actions, children }) {
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[130] bg-[var(--surface-overlay)] backdrop-blur-sm"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={reduceMotion ? {} : { opacity: 1 }}
          exit={reduceMotion ? {} : { opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose?.();
          }}
        >
          <motion.aside
            role="dialog"
            aria-modal="true"
            className="surface-panel ml-auto flex h-full w-full max-w-[560px] flex-col"
            initial={reduceMotion ? false : { x: 32, opacity: 0 }}
            animate={reduceMotion ? {} : { x: 0, opacity: 1 }}
            exit={reduceMotion ? {} : { x: 32, opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--surface-border)] px-5 py-4">
              <div>
                {title ? <h3 className="font-heading text-sm font-semibold uppercase tracking-[0.22em] text-[var(--text-primary)]">{title}</h3> : null}
                {description ? <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p> : null}
              </div>
              <IconButton onClick={onClose} variant="ghost" aria-label="Fechar painel lateral">
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {actions ? (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--surface-border)] px-5 py-4">
                {actions}
              </div>
            ) : null}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
