import React from 'react';
import { toast } from 'sonner';
import { Download, Copy } from 'lucide-react';

import Button from './ui/Button';
import Dialog from './ui/Dialog';
import IconButton from './ui/IconButton';
import StatusBadge from './ui/StatusBadge';

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

function credentialsText(title, fields) {
  const header = title ? `${title}\n\n` : '';
  const body = (fields || [])
    .map((field) => `${field.label}: ${field.value || ''}`)
    .join('\n');
  return `${header}${body}`.trim();
}

async function copyAll(title, fields) {
  const text = credentialsText(title, fields);
  await copyText('credenciais', text);
}

function downloadCredentials(title, fields) {
  const text = credentialsText(title, fields);
  if (!text) {
    toast.error('Nada para exportar.');
    return;
  }
  try {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const safeTitle = String(title || 'credenciais')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    anchor.href = url;
    anchor.download = `${safeTitle || 'credenciais'}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success('Arquivo de credenciais baixado.');
  } catch {
    toast.error('Falha ao baixar credenciais.');
  }
}

export default function CredentialPanel({ title, description, fields, onClose }) {
  if (!fields?.length) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={title}
      description={description || 'Copie ou exporte as credenciais antes de fechar.'}
      actions={
        <>
          <Button variant="ghost" onClick={() => downloadCredentials(title, fields)}>
            <Download className="h-4 w-4" />
            Baixar .txt
          </Button>
          <Button variant="secondary" onClick={() => copyAll(title, fields)}>
            <Copy className="h-4 w-4" />
            Copiar tudo
          </Button>
          <Button variant="primary" onClick={onClose}>
            Fechar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label="Sensivel" tone="warning" />
          <p className="text-sm text-[var(--text-muted)]">
            Senhas e tokens podem nao aparecer novamente. Guarde em local seguro.
          </p>
        </div>

        <div className="space-y-3">
          {fields.map((field) => (
            <div
              key={field.label}
              className="grid gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-4 md:grid-cols-[180px_1fr_auto]"
            >
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">{field.label}</p>
              </div>
              <input
                readOnly
                value={field.value || ''}
                className="h-11 w-full rounded-xl border border-[var(--surface-border)] bg-[var(--surface-base)] px-3 font-mono text-sm text-[var(--text-primary)]"
              />
              <div className="flex items-center justify-end gap-2">
                <IconButton
                  variant="secondary"
                  onClick={() => copyText(field.label, field.value)}
                  aria-label={`Copiar ${field.label}`}
                >
                  <Copy className="h-4 w-4" />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
