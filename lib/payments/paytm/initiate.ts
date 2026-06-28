// lib/payments/paytm/initiate.ts
// Paytm (India) — All-in-One SDK txnToken generator + hosted redirect URL.
// Server-side: reads merchant credentials from ENV vars only.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { amount, orderId, customer = {} } = body;

    const merchantId  = String(process.env.PAYTM_MID || '').trim();
    const merchantKey = String(process.env.PAYTM_MERCHANT_KEY || '').trim();
    const sandboxMode =
      process.env.PAYTM_SANDBOX !== undefined
        ? String(process.env.PAYTM_SANDBOX).toLowerCase() !== 'false'
        : (body.sandboxMode ?? true) !== false;

    if (!merchantId || !merchantKey) {
      return res.status(400).json({ error: 'Paytm credentials not configured.' });
    }
    if (!amount || !orderId) {
      return res.status(400).json({ error: 'amount and orderId are required.' });
    }

    const host = sandboxMode ? 'https://securegw-stage.paytm.in' : 'https://securegw.paytm.in';
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const origin = `${proto}://${req.headers.host}`;

    const reqBody = {
      requestType: 'Payment',
      mid: merchantId,
      websiteName: sandboxMode ? 'WEBSTAGING' : 'DEFAULT',
      orderId: String(orderId),
      callbackUrl: `${origin}/api/paytm/callback`,
      txnAmount: { value: Number(amount).toFixed(2), currency: 'INR' },
      userInfo: {
        custId: customer.email || customer.phone || `cust_${Date.now()}`,
        email: customer.email || undefined,
        mobile: customer.phone || undefined,
      },
    };

    const generateSignature = (data: string, key: string) => {
      const iv = '@@@@&&&&####$$$$';
      const cipher = crypto.createCipheriv('aes-128-cbc', key.slice(0, 16), iv);
      let encrypted = cipher.update(data, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      return encrypted;
    };

    const bodyStr = JSON.stringify(reqBody);
    const payload = { body: reqBody, head: { signature: generateSignature(bodyStr, merchantKey) } };

    const r = await fetch(
      `${host}/theia/api/v1/initiateTransaction?mid=${merchantId}&orderId=${encodeURIComponent(orderId)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    );
    const data: any = await r.json();
    const txnToken = data?.body?.txnToken;
    if (!txnToken) {
      return res.status(502).json({ error: data?.body?.resultInfo?.resultMsg || 'Paytm init failed.', detail: data });
    }
    const redirectUrl = `${host}/theia/api/v1/showPaymentPage?mid=${merchantId}&orderId=${encodeURIComponent(orderId)}`;
    return res.status(200).json({ success: true, txnToken, redirectUrl, mid: merchantId, orderId });
  } catch (e: any) {
    console.error('[paytm/initiate]', e);
    return res.status(500).json({ error: `Paytm API error: ${e?.message}` });
  }
}
