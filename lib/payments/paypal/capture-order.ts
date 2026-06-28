// api/paypal/capture-order.ts
// Captures an approved PayPal order after buyer returns from approval page.
// Credentials read from Firestore — never from client body.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGatewayCreds } from '../lib_payments/getGatewayCreds';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { orderId } = body;
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });

    const creds = await getGatewayCreds('paypal');
    if (body.sandboxMode !== undefined || body.isSandbox !== undefined) {
      creds.isSandbox = String(body.sandboxMode ?? body.isSandbox);
    }
    if (!creds.clientId || !creds.clientSecret) {
      return res.status(400).json({ error: 'Missing PayPal credentials' });
    }

    const isSandbox = String(creds.isSandbox).toLowerCase() !== 'false';
    const base = isSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

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
      return res.status(502).json({ error: 'PayPal token grant failed' });
    }

    const captureRes = await fetch(`${base}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
    });
    const captureData: any = await captureRes.json();
    if (captureData.status === 'COMPLETED') {
      const txnId = captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id;
      return res.status(200).json({ success: true, status: 'COMPLETED', transactionId: txnId });
    }
    return res.status(502).json({ error: 'PayPal capture failed', detail: captureData });
  } catch (e: any) {
    console.error('[paypal/capture-order]', e);
    return res.status(500).json({ error: e?.message });
  }
}
