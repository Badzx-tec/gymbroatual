import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { toast } from 'sonner';
import { Calendar, CreditCard, AlertCircle, CheckCircle, Clock } from 'lucide-react';

export default function SubscriptionPage() {
  const [billing, setBilling] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [amount, setAmount] = useState('99.90'); // Preço mensal padrão

  useEffect(() => {
    const userData = JSON.parse(localStorage.getItem('gymbro_user') || '{}');
    setUser(userData);
    if (userData.academy_id) {
      loadBilling(userData.academy_id);
    }
  }, []);

  const loadBilling = async (academyId) => {
    try {
      const data = await api.getAcademyBilling(academyId);
      setBilling(data);
    } catch (err) {
      toast.error('Erro ao carregar dados de faturamento');
    }
    setLoading(false);
  };

  const handlePayment = async () => {
    if (!user?.academy_id) {
      toast.error('Academia nao encontrada');
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Valor invalido');
      return;
    }

    setProcessing(true);
    try {
      const result = await api.createAcademySubscriptionCheckout({
        academy_id: user.academy_id,
        amount: parseFloat(amount),
        description: 'Assinatura mensal GymBro',
        payer_email: user.email,
      });
      
      if (result.checkout_url) {
        // Redireciona para Mercado Pago
        window.location.href = result.checkout_url;
      } else if (result.sandbox_checkout_url) {
        window.location.href = result.sandbox_checkout_url;
      } else {
        toast.error('Nao foi possivel gerar checkout');
      }
    } catch (err) {
      toast.error(err.message || 'Erro ao processar pagamento');
    }
    setProcessing(false);
  };

  const getStatusColor = (status) => {
    const colors = {
      trial: 'bg-blue-100 text-blue-800',
      active: 'bg-green-100 text-green-800',
      past_due: 'bg-yellow-100 text-yellow-800',
      canceled: 'bg-red-100 text-red-800',
    };
    return colors[status] || colors.trial;
  };

  const getStatusLabel = (status) => {
    const labels = {
      trial: '🎯 Em Período de Trial',
      active: '✅ Ativo',
      past_due: '⚠️ Vencido',
      canceled: '❌ Cancelado',
    };
    return labels[status] || status;
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    try {
      return new Date(dateString).toLocaleDateString('pt-BR');
    } catch {
      return dateString;
    }
  };

  const getDaysLeft = (dateString) => {
    if (!dateString) return 0;
    try {
      const date = new Date(dateString);
      const today = new Date();
      const diffTime = date - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays > 0 ? diffDays : 0;
    } catch {
      return 0;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#ccff00] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const status = billing?.status || 'trial';
  const trialDays = getDaysLeft(billing?.trial_until);
  const paidDays = getDaysLeft(billing?.paid_until);
  const isExpired = status === 'past_due' || (trialDays <= 0 && !billing?.paid_until);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold text-white mb-8">Plano de Assinatura</h1>

      {/* Status Card */}
      <div className={`rounded-lg p-6 mb-6 border ${status === 'active' ? 'bg-green-50 border-green-200' : status === 'trial' ? 'bg-blue-50 border-blue-200' : 'bg-yellow-50 border-yellow-200'}`}>
        <div className="flex items-start justify-between">
          <div>
            <div className={`inline-block px-4 py-2 rounded-full text-sm font-semibold mb-4 ${getStatusColor(status)}`}>
              {getStatusLabel(status)}
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">{billing?.academy_name || 'Sua Academia'}</h2>
            
            {/* Datas importantes */}
            <div className="grid grid-cols-2 gap-4 mt-4">
              {billing?.trial_until && (
                <div className="flex items-start gap-2">
                  <Calendar className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-600">Trial expira em:</p>
                    <p className="font-semibold text-gray-900">{formatDate(billing.trial_until)}</p>
                    {trialDays > 0 && <p className="text-xs text-blue-600">{trialDays} dias restantes</p>}
                  </div>
                </div>
              )}
              
              {billing?.paid_until && (
                <div className="flex items-start gap-2">
                  <CreditCard className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-600">Pago até:</p>
                    <p className="font-semibold text-gray-900">{formatDate(billing.paid_until)}</p>
                    {paidDays > 0 && <p className="text-xs text-green-600">{paidDays} dias restantes</p>}
                  </div>
                </div>
              )}
            </div>
          </div>

          {isExpired && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 px-4 py-2 rounded">
              <AlertCircle className="w-5 h-5" />
              <span className="font-semibold">Ação Necessária</span>
            </div>
          )}
        </div>
      </div>

      {/* Payment Form */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <CreditCard className="w-5 h-5" />
          Renovar Assinatura
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Valor (R$)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step="0.01"
              min="1"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ccff00] focus:border-transparent"
              disabled={processing}
            />
            <p className="text-xs text-gray-500 mt-1">Valor em reais (BRL)</p>
          </div>

          <button
            onClick={handlePayment}
            disabled={processing || parseFloat(amount) <= 0}
            className="w-full bg-[#ccff00] text-black font-bold py-3 rounded-lg hover:bg-[#b3e600] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? 'Processando...' : 'Pagar com Mercado Pago'}
          </button>

          <p className="text-xs text-gray-500 text-center">
            Você será redirecionado para o Mercado Pago para concluir o pagamento
          </p>
        </div>
      </div>

      {/* Billing History */}
      {billing?.billing_history && billing.billing_history.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Histórico de Pagamentos</h3>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Data</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Valor</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Status</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Válido até</th>
                </tr>
              </thead>
              <tbody>
                {billing.billing_history.map((record, idx) => (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">{formatDate(record.created_at)}</td>
                    <td className="py-3 px-4 font-semibold">R$ {record.amount?.toFixed(2)}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        record.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {record.status === 'approved' ? '✓ Aprovado' : record.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">{formatDate(record.paid_until)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-6">
        <div className="flex gap-3">
          <Clock className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-gray-700">
            <p className="font-semibold text-gray-900">Como funciona</p>
            <p className="mt-1">Todos os novos usuários começam com um período de trial de 30 dias. Após esse período, é necessário efetuar o pagamento mensal para manter a academia ativa.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
