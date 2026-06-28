// api/stripe/confirm-payment.ts
// Confirms a Stripe PaymentIntent with a PaymentMethod ID.
// Credentials read from Firestore — never from client body.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGatewayCreds } from '../lib_payments/getGatewayCreds';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { paymentIntentId, paymentMethodId } = body;
    if (!paymentIntentId || !paymentMethodId) {
      return res.status(400).json({ error: 'paymentIntentId and paymentMethodId are required' });
    }

    const creds = await getGatewayCreds('stripe');
    if (!creds.secretKey) {
      return res.status(400).json({ error: 'Missing Stripe secret key' });
    }

    const r = await fetch(
      `https://api.stripe.com/v1/payment_intents/${paymentIntentId}/confirm`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ payment_method: paymentMethodId }).toString(),
      },
    );

    const data: any = await r.json();
    if (data.error) return res.status(502).json({ error: data.error.message });
    if (data.status === 'succeeded' || data.status === 'requires_capture') {
      return res.status(200).json({ success: true, status: data.status, transactionId: data.id });
    }
    return res.status(502).json({ error: `Unexpected Stripe status: ${data.status}`, status: data.status });
  } catch (e: any) {
    console.error('[stripe/confirm-payment]', e);
    return res.status(500).json({ error: e?.message });
  }
}
