import React from 'react';

import StatusBadge from '../../components/ui/StatusBadge';
import { getBillingStatusMeta } from './billingUtils';

export default function BillingStatusBadge({ status, size = 'md', className }) {
  const meta = getBillingStatusMeta(status);
  return <StatusBadge label={meta.label} tone={meta.tone} size={size} className={className} />;
}
