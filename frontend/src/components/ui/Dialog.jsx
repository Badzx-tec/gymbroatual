import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

import { cn } from '../../lib/cn';
import IconButton from './IconButton';

const sizeMap = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
};

export default function Dialog({
  open,
  onClose,
  title,
  description,
  actions,
  size = 'md',
  children,
}) {
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-[var(--surface-overlay)] px-4 py-6 backdrop-blur-sm"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={reduceMotion ? {} : { opacity: 1 }}
          exit={reduceMotion ? {} : { opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose?.();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cn(
              'surface-panel w-full overflow-hidden rounded-[var(--radius-lg)]',
              sizeMap[size] || sizeMap.md
            )}
            initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
            animate={reduceMotion ? {} : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? {} : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--surface-border)] px-5 py-4">
              <div>
                {title ? <h3 className="font-heading text-sm font-semibold uppercase tracking-[0.22em] text-[var(--text-primary)]">{title}</h3> : null}
                {description ? <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p> : null}
              </div>
              <IconButton onClick={onClose} variant="ghost" aria-label="Fechar dialogo">
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="max-h-[76vh] overflow-y-auto px-5 py-4">{children}</div>
            {actions ? (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--surface-border)] px-5 py-4">
                {actions}
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
