// lib/payments/payfast/initiate.ts
// PayFast (South Africa) — signed auto-POST form.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { amount, orderId, customer = {}, productName } = body;

    const merchantId  = String(process.env.PAYFAST_MERCHANT_ID  || '').trim();
    const merchantKey = String(process.env.PAYFAST_MERCHANT_KEY || '').trim();
    const passphrase  = String(process.env.PAYFAST_PASSPHRASE   || '').trim();
    const sandboxMode =
      process.env.PAYFAST_SANDBOX !== undefined
        ? String(process.env.PAYFAST_SANDBOX).toLowerCase() !== 'false'
        : (body.sandboxMode ?? true) !== false;

    if (!merchantId || !merchantKey) {
      return res.status(400).json({ error: 'PayFast credentials not configured.' });
    }
    if (!amount || !orderId) {
      return res.status(400).json({ error: 'amount and orderId are required.' });
    }

    const postUrl = sandboxMode
      ? 'https://sandbox.payfast.co.za/eng/process'
      : 'https://www.payfast.co.za/eng/process';

    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const origin = `${proto}://${req.headers.host}`;

    const fields: Record<string, string> = {
      merchant_id: String(merchantId),
      merchant_key: String(merchantKey),
      return_url:  `${origin}/api/payfast/callback?status=success&orderId=${encodeURIComponent(orderId)}`,
      cancel_url:  `${origin}/api/payfast/callback?status=cancelled&orderId=${encodeURIComponent(orderId)}`,
      notify_url:  `${origin}/api/payfast/ipn`,
      name_first: (customer.name || 'Customer').split(' ')[0] || 'Customer',
      name_last:  (customer.name || '').split(' ').slice(1).join(' ') || '-',
      email_address: customer.email || 'customer@example.com',
      m_payment_id: String(orderId),
      amount: Number(amount).toFixed(2),
      item_name: String(productName || `Order ${orderId}`),
    };

    const encode = (v: any) => encodeURIComponent(String(v)).replace(/%20/g, '+');
    const sigStr = Object.keys(fields)
      .filter(k => fields[k] !== '' && fields[k] !== undefined)
      .map(k => `${k}=${encode(fields[k])}`)
      .join('&');
    const withPass = passphrase ? `${sigStr}&passphrase=${encode(passphrase)}` : sigStr;
    fields.signature = crypto.createHash('md5').update(withPass).digest('hex');

    return res.status(200).json({ success: true, postUrl, fields });
  } catch (e: any) {
    console.error('[payfast/initiate]', e);
    return res.status(500).json({ error: e?.message });
  }
}
