export function roleLabel(role) {
  const normalized = String(role || '').toUpperCase();
  if (normalized === 'OWNER') return 'Dono da academia';
  if (normalized === 'MANAGER') return 'Diretor';
  if (normalized === 'RECEPTION') return 'Recepcionista';
  if (normalized === 'TRAINER') return 'Treinador';
  if (normalized === 'STUDENT') return 'Aluno';
  if (normalized === 'SUPER_ADMIN') return 'Administrador da plataforma';
  return normalized || '-';
}

export function subjectTypeLabel(subjectType) {
  const normalized = String(subjectType || '').toLowerCase();
  if (normalized === 'student') return 'Aluno';
  if (normalized === 'employee') return 'Funcionario';
  if (normalized === 'owner') return 'Dono da academia';
  return '-';
}

export function directionLabel(direction) {
  const normalized = String(direction || '').toLowerCase();
  if (normalized === 'entry') return 'Entrada';
  if (normalized === 'exit') return 'Saida';
  if (normalized === 'both') return 'Ambas';
  return 'Nao informado';
}

export function contractStatusLabel(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active') return 'Ativo';
  if (normalized === 'pending_activation') return 'Aguardando ativacao';
  if (normalized === 'frozen') return 'Congelado';
  if (normalized === 'scheduled_cancel') return 'Cancelamento agendado';
  if (normalized === 'scheduled_freeze') return 'Congelamento agendado';
  if (normalized === 'canceled') return 'Cancelado';
  if (normalized === 'expired') return 'Expirado';
  if (normalized === 'ended') return 'Encerrado';
  return normalized ? normalized.replaceAll('_', ' ') : '-';
}

export function financialStatusLabel(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'paid') return 'Pago';
  if (normalized === 'pending') return 'Pendente';
  if (normalized === 'open') return 'Aberto';
  if (normalized === 'overdue') return 'Atrasado';
  if (normalized === 'failed') return 'Falhou';
  if (normalized === 'partially_paid') return 'Pago parcialmente';
  if (normalized === 'refunded') return 'Estornado';
  return normalized ? normalized.replaceAll('_', ' ') : '-';
}

export function accessStatusLabel(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'allowed') return 'Liberado';
  if (normalized === 'blocked') return 'Bloqueado';
  if (normalized === 'grace_period') return 'Carencia';
  if (normalized === 'suspended') return 'Suspenso';
  return normalized ? normalized.replaceAll('_', ' ') : '-';
}

export function archivedFlagLabel(isArchived) {
  return isArchived ? 'Arquivado' : 'Ativo';
}
