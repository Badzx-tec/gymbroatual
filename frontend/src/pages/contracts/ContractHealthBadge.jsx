import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { computeContractHealth } from './contractsUtils';

// ─── Tooltip via portal (avoids overflow clipping in table) ──────────────────

function HealthTooltip({ anchorRef, contract, health }) {
  const [style, setStyle] = useState({ opacity: 0, top: 0, left: 0 });
  const tooltipRef = useRef(null);

  React.useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const tooltipW = 200;
    const left = rect.left + rect.width / 2 - tooltipW / 2;
    setStyle({
      opacity: 1,
      top: rect.top - 8, // positioned above, transform will shift it up
      left: Math.max(8, Math.min(left, window.innerWidth - tooltipW - 8)),
    });
  }, [anchorRef]);

  return createPortal(
    <div
      ref={tooltipRef}
      style={{
        position: 'fixed',
        top: style.top,
        left: style.left,
        opacity: style.opacity,
        transform: 'translateY(-100%)',
        zIndex: 9998,
        width: 200,
        pointerEvents: 'none',
        transition: 'opacity 0.1s',
      }}
      className="rounded-xl border border-zinc-700/80 bg-zinc-900 p-3 shadow-2xl shadow-black/50"
    >
      <p className="mb-2 text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-600">
        Status detalhado
      </p>
      <div className="space-y-1.5">
        <TooltipRow label="Contrato" value={contract?.contract_status} />
        <TooltipRow label="Financeiro" value={contract?.financial_status} />
        <TooltipRow label="Acesso" value={contract?.access_status} />
        {contract?.is_archived && (
          <TooltipRow label="Arquivo" value="arquivado" warn />
        )}
        {contract?.grace_until && (
          <TooltipRow
            label="Graca ate"
            value={new Date(contract.grace_until).toLocaleDateString('pt-BR')}
            warn
          />
        )}
      </div>
      {/* Arrow */}
      <span
        className="absolute left-1/2 top-full -ml-2 border-4 border-transparent"
        style={{ borderTopColor: 'rgb(63 63 70)' }}
      />
    </div>,
    document.body
  );
}

function TooltipRow({ label, value, warn = false }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-zinc-600">{label}</span>
      <span className={`font-mono text-[10px] ${warn ? 'text-amber-300' : 'text-zinc-300'}`}>
        {String(value || '—').replaceAll('_', ' ')}
      </span>
    </div>
  );
}

// ─── Badge ─────────────────────────────────────────────────────────────────────

export default function ContractHealthBadge({ contract, showDetail = false }) {
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef(null);
  const anchorRef = useRef(null);
  const health = computeContractHealth(contract);

  const onEnter = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setHovered(true), 150);
  };
  const onLeave = () => {
    clearTimeout(timerRef.current);
    setHovered(false);
  };

  return (
    <span ref={anchorRef} className="relative inline-flex flex-col" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <span
        className={`inline-flex cursor-default items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${health.bgClass} ${health.textClass}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${health.dotClass}`} />
        {health.label}
      </span>

      {showDetail && (
        <span className="mt-1 text-[10px] text-zinc-600">{health.sublabel}</span>
      )}

      {hovered && (
        <HealthTooltip anchorRef={anchorRef} contract={contract} health={health} />
      )}
    </span>
  );
}
