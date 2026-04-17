import React from 'react';

import SelectField from '../../components/ui/SelectField';
import TextField from '../../components/ui/TextField';
import { HARD_DELETE_CONFIRM_PHRASE } from './useContractActions';

const HARD_DELETE_MIN_AGE_DAYS = 7;

/**
 * Renders the inner body of the contract action confirmation dialog.
 * Receives actionDialog state and a setter to update it.
 */
export default function ContractActionDialogBody({ actionDialog, setActionDialog }) {
  if (!actionDialog?.kind) {
    return (
      <p className="text-sm text-[var(--text-secondary)]">
        Confirme esta acao para seguir com a atualizacao do contrato.
      </p>
    );
  }

  const patch = (fields) =>
    setActionDialog((current) => ({ ...current, ...fields }));

  switch (actionDialog.kind) {
    case 'settle':
      return (
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Registre somente recebimentos reais. Para corrigir titulos indevidos, use a limpeza de pendencias invalidas.
          </p>
          <TextField
            label="Observacao"
            value={actionDialog.reason}
            onChange={(e) => patch({ reason: e.target.value })}
            placeholder="Ex.: pagamento confirmado no caixa"
          />
          <label className="flex items-start gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card-bg)] px-4 py-3 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              className="mt-1 accent-[var(--brand-primary)]"
              checked={Boolean(actionDialog.includeFutureOpen)}
              onChange={(e) => patch({ includeFutureOpen: e.target.checked })}
            />
            <span>Incluir tambem cobrancas futuras que ainda estao em aberto.</span>
          </label>
        </div>
      );

    case 'cleanup':
      return (
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Esta acao cancela cobrancas pendentes ou atrasadas que nao deveriam existir e recalcula o acesso do aluno sem marcar pagamento.
          </p>
          <TextField
            label="Motivo"
            value={actionDialog.reason}
            onChange={(e) => patch({ reason: e.target.value })}
            placeholder="Ex.: contrato duplicado ou cobranca indevida"
          />
        </div>
      );

    case 'pause':
      return (
        <TextField
          label="Dias de pausa"
          type="number"
          min="1"
          step="1"
          value={actionDialog.pauseDays}
          onChange={(e) => patch({ pauseDays: e.target.value })}
          placeholder="7"
        />
      );

    case 'cancel':
      return (
        <div className="space-y-4">
          <SelectField
            label="Quando aplicar"
            value={actionDialog.cancelMode}
            onChange={(e) => patch({ cancelMode: e.target.value })}
          >
            <option value="immediate">Cancelar imediatamente</option>
            <option value="end_of_cycle">Cancelar no fim do ciclo</option>
          </SelectField>
          <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-canvas)] px-4 py-3 text-sm text-[var(--text-secondary)]">
            {actionDialog.cancelMode === 'immediate'
              ? 'O acesso sera cortado agora e o contrato encerrado imediatamente.'
              : 'O contrato fica ativo ate o fim da vigencia atual e depois encerra automaticamente.'}
          </div>
          <TextField
            label="Motivo"
            value={actionDialog.reason}
            onChange={(e) => patch({ reason: e.target.value })}
            placeholder="Ex.: solicitacao do aluno"
          />
        </div>
      );

    case 'bulkCancel':
      return (
        <p className="text-sm text-[var(--text-secondary)]">
          {actionDialog.payload?.count || 0} contrato(s) selecionado(s) serao programados para cancelamento no fim do ciclo.
        </p>
      );

    case 'archive':
      return (
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Arquive apenas contratos que nao devem mais participar da leitura operacional nem da catraca.
          </p>
          <TextField
            label="Motivo do arquivamento"
            value={actionDialog.reason}
            onChange={(e) => patch({ reason: e.target.value })}
            placeholder="Ex.: contrato duplicado, criado por engano"
            required
          />
        </div>
      );

    case 'restore':
      return (
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Restaure somente se o contrato realmente precisar voltar para a operacao.
          </p>
          <TextField
            label="Observacao"
            value={actionDialog.reason}
            onChange={(e) => patch({ reason: e.target.value })}
            placeholder="Ex.: arquivamento feito por engano"
          />
        </div>
      );

    case 'removeCanceled':
      return (
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Essa manutencao apaga definitivamente contratos arquivados e terminais junto do historico vinculado.
          </p>
          <TextField
            label="Arquivados ha pelo menos quantos dias"
            type="number"
            min={String(HARD_DELETE_MIN_AGE_DAYS)}
            step="1"
            value={actionDialog.olderThanDays}
            onChange={(e) => patch({ olderThanDays: e.target.value })}
            placeholder={String(HARD_DELETE_MIN_AGE_DAYS)}
          />
          <TextField
            label={`Digite "${HARD_DELETE_CONFIRM_PHRASE}" para confirmar`}
            value={actionDialog.confirmPhrase}
            onChange={(e) => patch({ confirmPhrase: e.target.value })}
            placeholder={HARD_DELETE_CONFIRM_PHRASE}
          />
          <div className="rounded-2xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-4 py-3 text-sm text-[var(--status-danger-text)]">
            Use apenas depois de arquivar os contratos invalidos e confirmar que o historico nao sera mais necessario.
          </div>
        </div>
      );

    case 'unpayCharge':
    default:
      return (
        <p className="text-sm text-[var(--text-secondary)]">
          Confirme esta acao para seguir com a atualizacao do contrato.
        </p>
      );
  }
}
