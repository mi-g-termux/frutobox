// lib/payments/payfast/ipn.ts
// PayFast Instant Payment Notification webhook. We acknowledge to avoid retries.

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log('[PayFast IPN]', req.body);
  } catch {}
  res.status(200).send('OK');
}
