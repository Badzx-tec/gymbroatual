import React from 'react';
import { toast } from 'sonner';

function fallbackCopy(text) {
  const element = document.createElement('textarea');
  element.value = text;
  element.setAttribute('readonly', '');
  element.style.position = 'absolute';
  element.style.left = '-9999px';
  document.body.appendChild(element);
  element.select();
  document.execCommand('copy');
  document.body.removeChild(element);
}

async function copyText(label, value) {
  if (!value) {
    toast.error(`Nada para copiar em ${label}.`);
    return;
  }
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      fallbackCopy(value);
    }
    toast.success(`${label} copiado.`);
  } catch {
    try {
      fallbackCopy(value);
      toast.success(`${label} copiado.`);
    } catch {
      toast.error(`Falha ao copiar ${label}.`);
    }
  }
}

export default function CredentialPanel({ title, description, fields, onClose }) {
  if (!fields?.length) return null;

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold uppercase text-sm tracking-wide text-amber-200">{title}</h3>
          {description && <p className="text-xs text-amber-100/80 mt-1">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs uppercase tracking-wide px-2 py-1 rounded-sm bg-zinc-900/70 border border-zinc-700 hover:bg-zinc-800"
        >
          Fechar
        </button>
      </div>

      <div className="space-y-2">
        {fields.map((field) => (
          <div key={field.label} className="grid grid-cols-1 md:grid-cols-[170px_1fr_auto] gap-2 items-center">
            <span className="text-xs text-zinc-400 uppercase tracking-wide">{field.label}</span>
            <input
              readOnly
              value={field.value || ''}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-sm h-9 px-3 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => copyText(field.label, field.value)}
              className="bg-zinc-800 text-white font-semibold text-xs uppercase tracking-wide h-9 px-3 rounded-sm hover:bg-zinc-700"
            >
              Copiar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
