import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { api } from '../../api';

const HARD_DELETE_MIN_AGE_DAYS = 7;
export const HARD_DELETE_CONFIRM_PHRASE = 'REMOVER PERMANENTEMENTE';

/**
 * Manages all contract action state, dialogs, and mutations.
 * Receives loadContracts and loadDetail callbacks from useContracts.
 */
export function useContractActions({ loadContracts, loadDetail, setSelectedIds, queryState, role }) {
  const [busyAction, setBusyAction] = useState(false);
  const [actionDialog, setActionDialog] = useState(null);

  const canManageContractRules = ['OWNER', 'MANAGER'].includes(role);
  const canSettleOverdue = ['OWNER', 'MANAGER', 'RECEPTION'].includes(role);
  const canCreateContracts = ['OWNER', 'MANAGER', 'RECEPTION'].includes(role);

  const closeActionDialog = useCallback(() => setActionDialog(null), []);

  const openActionDialog = useCallback((kind, payload = {}) => {
    setActionDialog({
      kind,
      payload,
      pauseDays: '7',
      olderThanDays: String(HARD_DELETE_MIN_AGE_DAYS),
      includeFutureOpen: false,
      cancelMode: kind === 'cancel' ? 'immediate' : 'end_of_cycle',
      confirmPhrase: '',
      reason: '',
    });
  }, []);

  const runMutation = useCallback(
    async (task, successMessage, contractIdToReload = '') => {
      setBusyAction(true);
      try {
        await task();
        toast.success(successMessage);
        await loadContracts();
        if (contractIdToReload) await loadDetail(contractIdToReload);
        return true;
      } catch (err) {
        toast.error(err?.message || 'Falha ao executar acao.');
        return false;
      } finally {
        setBusyAction(false);
      }
    },
    [loadContracts, loadDetail]
  );

  const handleRowAction = useCallback(
    async (action, row) => {
      const contractId = row?.contract_id;
      if (!contractId && !['bulkCancel', 'removeCanceled'].includes(action)) return;

      switch (action) {
        case 'pdf':
          try {
            await api.adminContractPdf(contractId);
          } catch (err) {
            toast.error(err?.message || 'Falha ao baixar contrato em PDF.');
          }
          return;

        case 'copy':
          try {
            await navigator.clipboard.writeText(
              `${window.location.origin}/admin/contratos?contractId=${contractId}`
            );
            toast.success('Link copiado.');
          } catch {
            toast.error('Nao foi possivel copiar o link.');
          }
          return;

        case 'payCharge': {
          if (!canSettleOverdue) { toast.error('Sem permissao para registrar pagamento.'); return; }
          const chargeId = String(row?.charge_id || '').trim();
          if (!chargeId) { toast.error('Cobranca invalida.'); return; }
          await runMutation(
            () => api.markStudentChargePaid(chargeId, { payment_method: 'other', extend_contract: false }),
            'Cobranca marcada como paga.',
            contractId
          );
          return;
        }

        case 'unpayCharge':
          if (!canSettleOverdue) { toast.error('Sem permissao para cancelar pagamento.'); return; }
          openActionDialog(action, row);
          return;

        case 'settle':
          if (!canSettleOverdue) { toast.error('Sem permissao para registrar pagamento em lote.'); return; }
          openActionDialog(action, row);
          return;

        case 'cleanup':
          if (!canSettleOverdue) { toast.error('Sem permissao para limpar pendencias invalidas.'); return; }
          openActionDialog(action, row);
          return;

        case 'renew':
          await runMutation(
            () => api.adminRenewContract(contractId, { create_charge: true }),
            'Contrato renovado.',
            contractId
          );
          return;

        case 'pause':
          if (!canManageContractRules) { toast.error('Somente Dono da academia ou Diretor pode pausar contrato.'); return; }
          openActionDialog(action, row);
          return;

        case 'cancel':
          if (!canManageContractRules) { toast.error('Somente Dono da academia ou Diretor pode cancelar contrato.'); return; }
          openActionDialog(action, row);
          return;

        case 'archive':
        case 'restore':
          openActionDialog(action, row);
          return;

        default:
          break;
      }
    },
    [canSettleOverdue, canManageContractRules, openActionDialog, runMutation]
  );

  const confirmActionDialog = useCallback(async () => {
    if (!actionDialog?.kind) return;
    const payload = actionDialog.payload || {};
    const contractId = String(payload.contract_id || '').trim();

    if (actionDialog.kind === 'unpayCharge') {
      const chargeId = String(payload.charge_id || '').trim();
      if (!chargeId || !contractId) { toast.error('Cobranca invalida.'); return; }
      const ok = await runMutation(
        () => api.markStudentChargeUnpaid(chargeId, { reason: 'reversao manual na central de contratos' }),
        'Pagamento cancelado com sucesso.',
        contractId
      );
      if (ok) closeActionDialog();
      return;
    }

    if (actionDialog.kind === 'settle') {
      if (!contractId) { toast.error('Contrato invalido.'); return; }
      setBusyAction(true);
      try {
        const response = await api.adminSettleOverdueContract(contractId, {
          payment_method: 'other',
          include_future_open: Boolean(actionDialog.includeFutureOpen),
          reason: actionDialog.reason || 'baixa financeira manual na central de contratos',
        });
        const count = Number(response?.updated_charges || 0);
        toast.success(count > 0 ? `Pagamento registrado. Cobrancas baixadas: ${count}.` : 'Nenhuma cobranca pendente para baixa.');
        await loadContracts();
        await loadDetail(contractId);
        closeActionDialog();
      } catch (err) {
        toast.error(err?.message || 'Falha ao registrar pagamento em lote.');
      } finally {
        setBusyAction(false);
      }
      return;
    }

    if (actionDialog.kind === 'cleanup') {
      if (!contractId) { toast.error('Contrato invalido.'); return; }
      setBusyAction(true);
      try {
        const response = await api.adminCleanupInvalidContractCharges(contractId, {
          status_filter: 'pending',
          reason: actionDialog.reason || 'limpeza administrativa de pendencias invalidas',
        });
        const count = Number(response?.cleaned_count || 0);
        toast.success(count > 0 ? `Pendencias invalidas removidas: ${count}.` : 'Nenhuma pendencia invalida encontrada.');
        await loadContracts();
        await loadDetail(contractId);
        closeActionDialog();
      } catch (err) {
        toast.error(err?.message || 'Falha ao limpar pendencias invalidas.');
      } finally {
        setBusyAction(false);
      }
      return;
    }

    if (actionDialog.kind === 'pause') {
      const days = Number(actionDialog.pauseDays);
      if (!contractId) { toast.error('Contrato invalido.'); return; }
      if (!Number.isFinite(days) || days <= 0) { toast.error('Informe um numero de dias valido.'); return; }
      const ok = await runMutation(
        () => api.adminPauseContract(contractId, { days }),
        'Contrato pausado.',
        contractId
      );
      if (ok) closeActionDialog();
      return;
    }

    if (actionDialog.kind === 'cancel') {
      if (!contractId) { toast.error('Contrato invalido.'); return; }
      const mode = actionDialog.cancelMode === 'end_of_cycle' ? 'end_of_cycle' : 'immediate';
      const ok = await runMutation(
        () => api.adminCancelContract(contractId, { mode, reason: actionDialog.reason || 'cancelamento administrativo' }),
        mode === 'immediate' ? 'Contrato cancelado.' : 'Cancelamento agendado.',
        contractId
      );
      if (ok) closeActionDialog();
      return;
    }

    if (actionDialog.kind === 'archive') {
      if (!contractId) { toast.error('Contrato invalido.'); return; }
      if (!String(actionDialog.reason || '').trim()) { toast.error('Informe o motivo do arquivamento.'); return; }
      const ok = await runMutation(
        () => api.adminArchiveContract(contractId, { reason: actionDialog.reason.trim() }),
        'Contrato arquivado.',
        contractId
      );
      if (ok) closeActionDialog();
      return;
    }

    if (actionDialog.kind === 'restore') {
      if (!contractId) { toast.error('Contrato invalido.'); return; }
      const ok = await runMutation(
        () => api.adminRestoreContract(contractId, { reason: actionDialog.reason || undefined }),
        'Contrato restaurado.',
        contractId
      );
      if (ok) closeActionDialog();
      return;
    }

    if (actionDialog.kind === 'bulkCancel') {
      setBusyAction(true);
      try {
        const ids = actionDialog.payload?.ids || [];
        const results = await Promise.allSettled(
          ids.map((id) => api.adminCancelContract(id, { mode: 'end_of_cycle', reason: 'cancelamento em lote' }))
        );
        const success = results.filter((r) => r.status === 'fulfilled').length;
        toast.success(`Lote concluido. Sucesso: ${success} | Falhas: ${results.length - success}`);
        setSelectedIds([]);
        await loadContracts();
        if (queryState.contractId) await loadDetail(queryState.contractId);
        closeActionDialog();
      } catch (err) {
        toast.error(err?.message || 'Falha ao processar lote.');
      } finally {
        setBusyAction(false);
      }
      return;
    }

    if (actionDialog.kind === 'removeCanceled') {
      if (Number(actionDialog.olderThanDays || 0) < HARD_DELETE_MIN_AGE_DAYS) {
        toast.error(`A limpeza avancada exige no minimo ${HARD_DELETE_MIN_AGE_DAYS} dias de idade.`);
        return;
      }
      if (String(actionDialog.confirmPhrase || '').trim().toUpperCase() !== HARD_DELETE_CONFIRM_PHRASE) {
        toast.error(`Digite exatamente "${HARD_DELETE_CONFIRM_PHRASE}" para continuar.`);
        return;
      }
      setBusyAction(true);
      try {
        const response = await api.adminRemoveCanceledContracts({
          older_than_days: Number(actionDialog.olderThanDays),
          confirm_phrase: actionDialog.confirmPhrase.trim(),
        });
        toast.success(
          `Limpeza concluida. Contratos removidos: ${Number(response?.removed_contracts || 0)}. Cobrancas: ${Number(response?.removed_charges || 0)}.`
        );
        setSelectedIds([]);
        await loadContracts();
        closeActionDialog();
      } catch (err) {
        toast.error(err?.message || 'Falha ao executar limpeza avancada.');
      } finally {
        setBusyAction(false);
      }
    }
  }, [actionDialog, runMutation, loadContracts, loadDetail, closeActionDialog, setSelectedIds, queryState.contractId]);

  const actionDialogMeta = useMemo(() => {
    if (!actionDialog?.kind) return null;
    const map = {
      unpayCharge: { title: 'Cancelar pagamento', description: 'A cobranca volta para pendente ou atrasada conforme o vencimento.', confirmLabel: 'Cancelar pagamento', confirmVariant: 'danger' },
      settle: { title: 'Registrar pagamento em lote', description: 'Use esta acao somente para baixa financeira real das cobrancas vencidas.', confirmLabel: 'Registrar pagamento', confirmVariant: 'primary' },
      cleanup: { title: 'Limpar pendencias invalidas', description: 'Cancela titulos indevidos ou duplicados sem simular pagamento.', confirmLabel: 'Limpar pendencias', confirmVariant: 'primary' },
      pause: { title: 'Pausar contrato', description: 'Defina quantos dias a vigencia deve ser empurrada para frente.', confirmLabel: 'Aplicar pausa', confirmVariant: 'primary' },
      cancel: { title: 'Cancelar contrato', description: 'Escolha se o cancelamento corta o acesso agora ou no fim do ciclo atual.', confirmLabel: 'Confirmar cancelamento', confirmVariant: 'danger' },
      bulkCancel: { title: 'Cancelar contratos selecionados', description: 'Todos os contratos selecionados serao programados para encerramento no fim do ciclo.', confirmLabel: 'Cancelar selecionados', confirmVariant: 'danger' },
      archive: { title: 'Arquivar contrato invalido', description: 'O contrato some do fluxo operacional, mas o historico continua preservado.', confirmLabel: 'Arquivar contrato', confirmVariant: 'danger' },
      restore: { title: 'Restaurar contrato arquivado', description: 'O contrato volta a aparecer no fluxo operacional e pode voltar a dirigir o acesso.', confirmLabel: 'Restaurar contrato', confirmVariant: 'primary' },
      removeCanceled: { title: 'Limpeza avancada', description: 'Remove definitivamente apenas contratos arquivados e terminais com idade minima e confirmacao forte.', confirmLabel: 'Executar limpeza', confirmVariant: 'danger' },
    };
    return map[actionDialog.kind] || null;
  }, [actionDialog]);

  return {
    busyAction,
    actionDialog,
    setActionDialog,
    openActionDialog,
    closeActionDialog,
    handleRowAction,
    confirmActionDialog,
    actionDialogMeta,
    canCreateContracts,
    canManageContractRules,
    canSettleOverdue,
  };
}
