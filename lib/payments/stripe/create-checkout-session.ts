// api/stripe/create-checkout-session.ts
// Creates a Stripe Checkout Session and returns its hosted URL.
// Use this when you want Stripe's hosted payment page instead of building
// your own card form. The session URL handles 3DS, wallets, taxes, etc.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGatewayCreds, missingCreds } from '../lib_payments/getGatewayCreds';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const {
      amount,
      currency = 'usd',
      orderId,
      productName = 'Order',
      customerEmail,
      successUrl,
      cancelUrl,
    } = body;

    if (!amount || isNaN(Number(amount))) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    if (!successUrl || !cancelUrl) {
      return res.status(400).json({ error: 'successUrl and cancelUrl are required' });
    }

    const creds = await getGatewayCreds('stripe');

    const missing = missingCreds(creds, ['secretKey']);
    if (missing.length) {
      return res.status(400).json({
        error: `Missing Stripe credentials: ${missing.join(', ')}. Set STRIPE_SECRET_KEY in environment variables.`,
      });
    }

    const amountCents = Math.round(Number(amount) * 100);
    const params = new URLSearchParams({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': String(currency).toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(amountCents),
      'line_items[0][price_data][product_data][name]': String(productName).slice(0, 250),
    });
    if (customerEmail) params.set('customer_email', String(customerEmail));
    if (orderId) {
      params.set('client_reference_id', String(orderId).slice(0, 200));
      params.set('metadata[orderId]', String(orderId).slice(0, 500));
    }

    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data: any = await r.json();
    if (data.error) return res.status(502).json({ error: data.error.message });
    if (!data.id || !data.url) {
      return res.status(502).json({ error: 'Stripe did not return a checkout URL.' });
    }
    return res.status(200).json({ success: true, sessionId: data.id, url: data.url });
  } catch (e: any) {
    console.error('[stripe/create-checkout-session]', e);
    return res.status(500).json({ error: e?.message });
  }
}
