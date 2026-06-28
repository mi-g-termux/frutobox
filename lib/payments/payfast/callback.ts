// lib/payments/payfast/callback.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const status  = String(req.query.status  ?? (req.body as any)?.status        ?? '');
  const orderId = String(req.query.orderId ?? (req.body as any)?.m_payment_id  ?? '');

  const qs = new URLSearchParams({
    payfast: status === 'success' ? 'success' : 'cancelled',
    ...(orderId ? { orderId } : {}),
  }).toString();

  res.setHeader('Location', `/?${qs}`);
  return res.status(302).end();
}
