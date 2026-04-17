import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

// ─── Portal dropdown ──────────────────────────────────────────────────────────
// Renders outside overflow-clipped table containers via document.body portal.

function PortalMenu({ triggerRef, sections, onClose }) {
  const [pos, setPos] = useState({ opacity: 0, top: 0, left: 0 });

  useEffect(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const W = 196;
    const itemCount = sections.reduce((sum, sec) => sum + sec.length, 0);
    const sepCount = Math.max(0, sections.length - 1);
    const H = itemCount * 34 + sepCount * 10 + 16;
    const top =
      window.innerHeight - rect.bottom < H && rect.top > H
        ? rect.top - H - 4
        : rect.bottom + 4;
    const left = Math.max(8, rect.right - W);
    setPos({ opacity: 1, top, left });
  }, [triggerRef]); // eslint-disable-line

  const handleOutside = useCallback(
    (e) => {
      if (!e.target.closest('[data-portal-menu]')) onClose();
    },
    [onClose]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [handleOutside, onClose]);

  return createPortal(
    <div
      data-portal-menu
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        opacity: pos.opacity,
        zIndex: 9999,
        width: 196,
        transition: 'opacity 0.08s',
      }}
      className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-raised)] py-1.5 shadow-2xl shadow-black/60"
    >
      {sections.map((items, si) => (
        <React.Fragment key={si}>
          {si > 0 && <div className="mx-2 my-1 border-t border-[var(--surface-border)]" />}
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation();
                item.onClick();
                onClose();
              }}
              className={`mx-1 flex w-[calc(100%-8px)] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-30 ${
                item.danger
                  ? 'text-[var(--status-danger)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger-text)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]'
              }`}
            >
              {item.icon && <item.icon className="h-3.5 w-3.5 shrink-0" />}
              {item.label}
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>,
    document.body
  );
}

// ─── Public component ─────────────────────────────────────────────────────────
// Usage:
//   <TableActionMenu sections={[
//     [{ label: 'Ver', icon: Eye, onClick: () => ... }],
//     [{ label: 'Remover', icon: Trash2, danger: true, onClick: () => ... }],
//   ]} />

export default function TableActionMenu({ sections, label = 'Acoes da linha' }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-transparent text-[var(--text-muted)] transition hover:border-[var(--surface-border-strong)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-secondary)]"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <PortalMenu
          triggerRef={triggerRef}
          sections={sections}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
