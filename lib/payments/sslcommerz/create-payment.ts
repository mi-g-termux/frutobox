// api/sslcommerz/create-payment.ts
// SSLCommerz session create — returns GatewayPageURL for redirect.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGatewayCreds, missingCreds } from '../lib_payments/getGatewayCreds';

// Module-level dedup set — survives within a single warm lambda/process instance.
// Prevents duplicate SSLCommerz sessions from rapid repeated client-side calls.
const _pendingOrders = new Set<string>();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const { amount, orderId, customer = {}, productName = 'Order' } = body;
  if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId required' });
  if (_pendingOrders.has(orderId)) {
    return res.status(429).json({ error: 'Payment already being processed for this order. Please wait.' });
  }
  _pendingOrders.add(orderId);

  try {
    const creds = await getGatewayCreds('sslcommerz');
    if (body.sandboxMode !== undefined || body.isSandbox !== undefined) {
      creds.isSandbox = String(body.sandboxMode ?? body.isSandbox);
    }

    const missing = missingCreds(creds, ['storeId', 'storePass']);
    if (missing.length) {
      return res.status(400).json({ error: `Missing SSLCommerz credentials: ${missing.join(', ')}. Set SSLCZ_STORE_ID and SSLCZ_STORE_PASSWORD in environment variables.` });
    }

    const sandbox = String(creds.isSandbox).toLowerCase() !== 'false';
    const base = sandbox
      ? 'https://sandbox.sslcommerz.com'
      : 'https://securepay.sslcommerz.com';

    const origin = getOrigin(req);
    // SSLCommerz requires total_amount as a plain decimal number string (no trailing zeros beyond 2dp)
    const amountFormatted = parseFloat(String(amount)).toFixed(2);

    const form = new URLSearchParams({
      store_id: creds.storeId,
      store_passwd: creds.storePass,
      total_amount: amountFormatted,
      currency: 'BDT',
      tran_id: orderId,
      success_url: `${origin}/api/sslcommerz/ipn?status=success&orderId=${encodeURIComponent(orderId)}`,
      fail_url:    `${origin}/api/sslcommerz/ipn?status=fail&orderId=${encodeURIComponent(orderId)}`,
      cancel_url:  `${origin}/api/sslcommerz/ipn?status=cancel&orderId=${encodeURIComponent(orderId)}`,
      ipn_url:     `${origin}/api/sslcommerz/ipn`,
      cus_name:    customer.name    || 'Customer',
      cus_email:   customer.email   || 'noreply@example.com',
      cus_phone:   customer.phone   || '01700000000',
      cus_add1:    customer.address || 'N/A',
      cus_city:    customer.city    || 'Dhaka',
      cus_country: customer.country || 'Bangladesh',
      shipping_method:  'NO',
      product_name:     productName,
      product_category: 'general',
      product_profile:  'general',
      num_of_item:      '1',       // required by SSLCommerz API
      value_a:          orderId,   // echo back for IPN cross-check
    });

    const r = await fetch(`${base}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });

    const text = await r.text();
    let j: any;
    try {
      j = JSON.parse(text);
    } catch (parseErr) {
      console.error('[sslcz/create] invalid JSON response', { status: r.status, text, err: parseErr });
      return res.status(502).json({
        error: 'SSLCommerz returned invalid JSON',
        status: r.status,
        detail: text,
      });
    }

    if (j?.status !== 'SUCCESS' || !j?.GatewayPageURL) {
      return res.status(502).json({ error: 'SSLCommerz session failed', detail: j });
    }

    return res.status(200).json({ redirectUrl: j.GatewayPageURL, sessionkey: j.sessionkey });
  } catch (e: any) {
    console.error('[sslcz/create]', e);
    return res.status(500).json({ error: e?.message });
  } finally {
    setTimeout(() => _pendingOrders.delete(orderId), 30_000);
  }
}

function getOrigin(req: VercelRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  return `${proto}://${req.headers.host}`;
}
