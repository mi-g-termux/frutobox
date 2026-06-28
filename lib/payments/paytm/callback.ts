// lib/payments/paytm/callback.ts
// Paytm hosted-page POST callback → redirects user back to the SPA with a status query.

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const status  = String((req.body as any)?.STATUS  ?? req.query.STATUS  ?? '');
  const orderId = String((req.body as any)?.ORDERID ?? req.query.ORDERID ?? '');
  const txnId   = String((req.body as any)?.TXNID   ?? req.query.TXNID   ?? '');

  const qs = new URLSearchParams({
    paytm: status === 'TXN_SUCCESS' ? 'success' : status === 'PENDING' ? 'pending' : 'failed',
    ...(orderId ? { orderId } : {}),
    ...(txnId   ? { txnId   } : {}),
  }).toString();

  res.setHeader('Location', `/?${qs}`);
  return res.status(302).end();
}
