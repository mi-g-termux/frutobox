// lib/payments/jazzcash/callback.ts
// JazzCash redirects the customer back here with form-POST results.

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code    = String((req.body as any)?.pp_ResponseCode  ?? req.query.pp_ResponseCode  ?? '');
  const orderId = String((req.body as any)?.pp_BillReference ?? req.query.pp_BillReference ?? '');
  const txnRef  = String((req.body as any)?.pp_TxnRefNo      ?? req.query.pp_TxnRefNo      ?? '');

  const qs = new URLSearchParams({
    jazzcash: code === '000' ? 'success' : 'failed',
    code,
    ...(orderId ? { orderId } : {}),
    ...(txnRef  ? { txnRef  } : {}),
  }).toString();

  res.setHeader('Location', `/?${qs}`);
  return res.status(302).end();
}
