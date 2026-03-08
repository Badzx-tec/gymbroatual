import React from 'react';

import { api } from '../../api';

const DEFAULT_STATE = {
  subscription: null,
  membership: null,
  invoices: [],
  attempts: [],
  events: [],
  summary: {},
};

export default function useBillingOverview({
  invoiceLimit = 12,
  attemptLimit = 12,
  eventLimit = 16,
} = {}) {
  const [data, setData] = React.useState(DEFAULT_STATE);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState('');

  const load = React.useCallback(
    async ({ silent = false, refresh = false } = {}) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError('');
      try {
        const response = await api.billingOverview({
          invoiceLimit,
          attemptLimit,
          eventLimit,
          refresh,
        });
        setData(response || DEFAULT_STATE);
        return response || DEFAULT_STATE;
      } catch (err) {
        const message = err?.message || 'Falha ao carregar a cobranca.';
        setError(message);
        throw err;
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [attemptLimit, eventLimit, invoiceLimit]
  );

  React.useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return {
    data,
    loading,
    refreshing,
    error,
    reload: () => load({ silent: true }),
    syncWithProvider: () => load({ silent: true, refresh: true }),
  };
}
