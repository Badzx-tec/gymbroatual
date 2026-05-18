import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import Button from '../../components/ui/Button';
import Dialog from '../../components/ui/Dialog';
import SelectField from '../../components/ui/SelectField';
import TextField from '../../components/ui/TextField';
import {
  calculateContractEndAt,
  formatContractValueBreakdown,
  formatDate,
  formatDurationLabel,
  toIsoDate,
  toLocalDateInput,
} from './contractsUtils';

const FORM_DEFAULT = {
  student_id: '',
  plan_id: '',
  amount: '',
  discount_amount: '',
  duration_value: '',
  duration_unit: 'days',
  start_at: '',
  end_at: '',
  billing_day: '',
  auto_renew: false,
  create_initial_charge: true,
  payment_method: 'pix',
};

const PAYMENT_METHODS = [
  ['pix', 'PIX'],
  ['card', 'Cartao'],
  ['cash', 'Dinheiro'],
  ['boleto', 'Boleto'],
  ['transfer', 'Transferencia'],
];

function getDefaultStart() {
  return toLocalDateInput(new Date().toISOString());
}

function getDefaultBillingDay(startAt) {
  const day = Number(String(startAt).split('T')[0]?.split('-')[2] || 1);
  return String(Math.min(Math.max(day, 1), 28));
}

export default function CreateContractDialog({
  open,
  onClose,
  students = [],
  plans = [],
  plansById,
  busy = false,
  onSubmit,
}) {
  const [form, setForm] = useState(() => {
    const startAt = getDefaultStart();
    return { ...FORM_DEFAULT, start_at: startAt, billing_day: getDefaultBillingDay(startAt) };
  });
  const [manualEndEdited, setManualEndEdited] = useState(false);

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      const startAt = getDefaultStart();
      setForm({ ...FORM_DEFAULT, start_at: startAt, billing_day: getDefaultBillingDay(startAt) });
      setManualEndEdited(false);
    }
  }, [open]);

  const recalcEndAt = useCallback((nextForm) => {
    if (manualEndEdited) return nextForm;
    const selectedPlan = plansById?.get(nextForm.plan_id);
    const durationUnit = nextForm.duration_unit || selectedPlan?.duration_unit || 'days';
    const durationValue = Number(
      nextForm.duration_value
        || selectedPlan?.duration_value
        || selectedPlan?.duracao_dias
        || 0
    );
    if (!nextForm.start_at || durationValue <= 0) return nextForm;
    const endAt = calculateContractEndAt(nextForm.start_at, durationUnit, durationValue);
    return endAt ? { ...nextForm, end_at: endAt } : nextForm;
  }, [manualEndEdited, plansById]);

  const valueBreakdown = useMemo(() => {
    const base = Number(form.amount || 0);
    const discount = Math.max(0, Number(form.discount_amount || 0));
    return formatContractValueBreakdown({
      original_amount: base,
      discount_amount: discount,
      amount: Math.max(0, base - discount),
    });
  }, [form.amount, form.discount_amount]);

  const durationLabel = useMemo(() => {
    const selectedPlan = plansById?.get(form.plan_id);
    return formatDurationLabel(
      form.duration_value || selectedPlan?.duration_value,
      form.duration_unit || selectedPlan?.duration_unit,
      selectedPlan?.duracao_dias
    );
  }, [form.duration_unit, form.duration_value, form.plan_id, plansById]);

  const endPreviewLabel = useMemo(() => {
    const iso = toIsoDate(form.end_at);
    return iso ? formatDate(iso) : '-';
  }, [form.end_at]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const base = Number(form.amount || 0);
    const discount = Number(form.discount_amount || 0);
    if (discount < 0) { toast.error('Informe um desconto valido.'); return; }
    if (base > 0 && discount >= base) { toast.error('O desconto precisa ser menor que o valor base do contrato.'); return; }

    const payload = {
      student_id: form.student_id,
      plan_id: form.plan_id || undefined,
      amount: form.amount ? Number(form.amount) : undefined,
      discount_amount: form.discount_amount ? Number(form.discount_amount) : 0,
      duration_value: form.duration_value ? Number(form.duration_value) : undefined,
      duration_unit: form.duration_unit || 'days',
      start_at: toIsoDate(form.start_at) || undefined,
      end_at: toIsoDate(form.end_at) || undefined,
      billing_day: form.billing_day ? Number(form.billing_day) : undefined,
      auto_renew: Boolean(form.auto_renew),
      create_initial_charge: Boolean(form.create_initial_charge),
      payment_method: form.payment_method || undefined,
    };

    await onSubmit(payload);
  };

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Novo contrato"
      description="Cadastro rapido com calculo automatico da validade em America/Sao_Paulo e configuracao financeira separada."
      size="lg"
      actions={
        <>
          <Button type="button" onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button type="submit" form="contract-create-form" loading={busy} disabled={busy} variant="primary">
            Criar contrato
          </Button>
        </>
      }
    >
      <form id="contract-create-form" onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SelectField
          label="Aluno"
          required
          className="md:col-span-2"
          value={form.student_id}
          onChange={(e) => set({ student_id: e.target.value })}
        >
          <option value="">Selecione um aluno</option>
          {students.map((s) => (
            <option key={s.student_id} value={s.student_id}>{s.nome}</option>
          ))}
        </SelectField>

        <SelectField
          label="Plano"
          value={form.plan_id}
          onChange={(e) => {
            const next = { ...form, plan_id: e.target.value };
            const plan = plansById?.get(e.target.value);
            if ((plan?.duration_value || plan?.duracao_dias) && !form.duration_value) {
              next.duration_value = String(plan.duration_value || plan.duracao_dias);
              next.duration_unit = plan.duration_unit || 'days';
            }
            if (plan?.valor && !form.amount) next.amount = String(plan.valor);
            if (plan && !form.billing_day && next.start_at) {
              next.billing_day = getDefaultBillingDay(next.start_at);
            }
            setForm(recalcEndAt(next));
          }}
        >
          <option value="">Sem plano vinculado</option>
          {plans.map((plan) => (
            <option key={plan.plan_id} value={plan.plan_id}>{plan.nome}</option>
          ))}
        </SelectField>

        <SelectField
          label="Forma de pagamento"
          value={form.payment_method}
          onChange={(e) => set({ payment_method: e.target.value })}
        >
          {PAYMENT_METHODS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </SelectField>

        <TextField
          label="Valor"
          type="number"
          min="0.01"
          step="0.01"
          value={form.amount}
          onChange={(e) => set({ amount: e.target.value })}
          placeholder="0,00"
        />

        <TextField
          label="Desconto"
          type="number"
          min="0"
          step="0.01"
          value={form.discount_amount}
          onChange={(e) => set({ discount_amount: e.target.value })}
          placeholder="0,00"
        />

        <TextField
          label="Quantidade"
          type="number"
          min="1"
          value={form.duration_value}
          onChange={(e) => setForm((prev) => recalcEndAt({ ...prev, duration_value: e.target.value }))}
          placeholder="1"
        />

        <SelectField
          label="Unidade de duracao"
          value={form.duration_unit}
          onChange={(e) => setForm((prev) => recalcEndAt({ ...prev, duration_unit: e.target.value }))}
        >
          <option value="days">Dias</option>
          <option value="months">Meses</option>
        </SelectField>

        <TextField
          label="Inicio da validade"
          type="datetime-local"
          value={form.start_at}
          onChange={(e) => setForm((prev) => recalcEndAt({ ...prev, start_at: e.target.value }))}
        />

        <TextField
          label="Validade do contrato"
          type="datetime-local"
          value={form.end_at}
          onChange={(e) => {
            setManualEndEdited(Boolean(e.target.value));
            set({ end_at: e.target.value });
          }}
        />

        <TextField
          label="Dia de cobranca"
          type="number"
          min="1"
          max="28"
          value={form.billing_day}
          onChange={(e) => set({ billing_day: e.target.value })}
          placeholder="10"
        />

        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Resumo de vigencia</p>
          <p className="mt-2 text-sm text-[var(--text-primary)]">{durationLabel}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Fim calculado: {endPreviewLabel}</p>
        </div>

        <label className="flex items-start gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            className="mt-1 accent-[var(--brand-primary)]"
            checked={form.auto_renew}
            onChange={(e) => set({ auto_renew: e.target.checked })}
          />
          <span>Renovacao automatica</span>
        </label>

        <label className="flex items-start gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            className="mt-1 accent-[var(--brand-primary)]"
            checked={form.create_initial_charge}
            onChange={(e) => set({ create_initial_charge: e.target.checked })}
          />
          <span>Criar cobranca inicial ao salvar</span>
        </label>

        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-4 md:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Resumo financeiro e de vigencia
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div>
              <p className="text-xs text-[var(--text-muted)]">Valor base</p>
              <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{valueBreakdown.originalLabel}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">Desconto</p>
              <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                {valueBreakdown.hasDiscount ? `- ${valueBreakdown.discountLabel}` : 'Nenhum'}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">Valor final</p>
              <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{valueBreakdown.finalLabel}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div>
              <p className="text-xs text-[var(--text-muted)]">Duracao</p>
              <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{durationLabel}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">Validade final</p>
              <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{endPreviewLabel}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">Dia de cobranca</p>
              <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{form.billing_day || '-'}</p>
            </div>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
