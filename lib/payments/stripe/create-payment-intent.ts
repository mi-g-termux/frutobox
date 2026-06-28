// api/stripe/create-payment-intent.ts
// Creates a Stripe PaymentIntent server-side.
// Credentials are read from Firestore (settings/paymentSettings) — never trusted from client.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGatewayCreds, missingCreds } from '../lib_payments/getGatewayCreds';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { amount, currency = 'usd' } = body;
    if (!amount || isNaN(Number(amount))) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const creds = await getGatewayCreds('stripe');

    const missing = missingCreds(creds, ['secretKey']);
    if (missing.length) {
      return res.status(400).json({ error: `Missing Stripe credentials: ${missing.join(', ')}. Set STRIPE_SECRET_KEY in environment variables.` });
    }

    const amountCents = Math.round(Number(amount) * 100);
    const r = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        amount: String(amountCents),
        currency: currency.toLowerCase(),
        'automatic_payment_methods[enabled]': 'true',
      }).toString(),
    });

    const data: any = await r.json();
    if (data.error) return res.status(502).json({ error: data.error.message });
    return res.status(200).json({
      success: true,
      clientSecret: data.client_secret,
      paymentIntentId: data.id,
    });
  } catch (e: any) {
    console.error('[stripe/create-payment-intent]', e);
    return res.status(500).json({ error: e?.message });
  }
}
