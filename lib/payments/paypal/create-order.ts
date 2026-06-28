// api/paypal/create-order.ts
// Creates a PayPal order and returns the approval URL for redirect.
// Credentials read from Firestore (settings/paymentSettings) — never trusted from client.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGatewayCreds, missingCreds } from '../lib_payments/getGatewayCreds';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { amount, currency = 'USD' } = body;
    if (!amount || isNaN(Number(amount))) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const creds = await getGatewayCreds('paypal');
    if (body.sandboxMode !== undefined || body.isSandbox !== undefined) {
      creds.isSandbox = String(body.sandboxMode ?? body.isSandbox);
    }

    const missing = missingCreds(creds, ['clientId', 'clientSecret']);
    if (missing.length) {
      return res.status(400).json({ error: `Missing PayPal credentials: ${missing.join(', ')}. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in environment variables.` });
    }

    const isSandbox = String(creds.isSandbox).toLowerCase() !== 'false';
    const base = isSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

    // Get OAuth token
    const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' + Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const tokenData: any = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(502).json({ error: 'PayPal token grant failed', detail: tokenData });
    }

    const origin = getOrigin(req);
    const orderRes = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          { amount: { currency_code: currency.toUpperCase(), value: Number(amount).toFixed(2) } },
        ],
        application_context: {
          return_url: `${origin}/api/paypal/callback?status=success`,
          cancel_url: `${origin}/api/paypal/callback?status=cancelled`,
        },
      }),
    });

    const orderData: any = await orderRes.json();
    if (!orderData.id) {
      return res.status(502).json({ error: 'PayPal order creation failed', detail: orderData });
    }
    const approvalUrl = orderData.links?.find((l: any) => l.rel === 'approve')?.href;
    return res.status(200).json({ success: true, orderId: orderData.id, approvalUrl });
  } catch (e: any) {
    console.error('[paypal/create-order]', e);
    return res.status(500).json({ error: e?.message });
  }
}

function getOrigin(req: VercelRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  return `${proto}://${req.headers.host}`;
}
