// lib/payments/easypaisa/callback.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const status  = String((req.body as any)?.status         ?? req.query.status         ?? '');
  const orderId = String((req.body as any)?.orderRefNumber ?? req.query.orderRefNumber ?? '');
  const txnRef  = String((req.body as any)?.transactionId  ?? req.query.transactionId  ?? '');

  const qs = new URLSearchParams({
    easypaisa: status === '0000' || status === 'success' ? 'success' : 'failed',
    ...(orderId ? { orderId } : {}),
    ...(txnRef  ? { txnRef  } : {}),
  }).toString();

  res.setHeader('Location', `/?${qs}`);
  return res.status(302).end();
}
