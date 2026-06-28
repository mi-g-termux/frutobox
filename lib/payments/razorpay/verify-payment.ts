// api/razorpay/verify-payment.ts
// Verifies the HMAC signature returned by Razorpay Checkout.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { getGatewayCreds } from '../lib_payments/getGatewayCreds';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing Razorpay fields' });
    }
    const creds = await getGatewayCreds('razorpay');
    const keySecret = String((req.body || {}).keySecret || creds.keySecret || '');
    if (!keySecret) return res.status(400).json({ error: 'Missing Razorpay secret' });

    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const ok =
      expected.length === razorpay_signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpay_signature));

    return res.status(200).json({ success: ok, verified: ok });
  } catch (e: any) {
    console.error('[razorpay/verify]', e);
    return res.status(500).json({ error: e?.message });
  }
}
