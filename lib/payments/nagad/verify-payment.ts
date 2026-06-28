// api/nagad/verify-payment.ts
// Verifies a Nagad payment by paymentRefId returned via callback.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGatewayCreds } from '../lib_payments/getGatewayCreds';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const paymentRefId =
    (req.query.payment_ref_id as string) || (req.body && req.body.paymentRefId);
  if (!paymentRefId) return res.status(400).json({ error: 'paymentRefId required' });

  try {
    const creds = await getGatewayCreds('nagad');
    const url = `${creds.baseUrl}/verify/payment/${paymentRefId}`;
    const r = await fetch(url);
    const j: any = await r.json();
    const success = j?.status === 'Success' || j?.statusCode === '000';
    return res.status(200).json({ success, raw: j });
  } catch (e: any) {
    console.error('[nagad/verify]', e);
    return res.status(500).json({ error: e?.message });
  }
}
