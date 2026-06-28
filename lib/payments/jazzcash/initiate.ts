// lib/payments/jazzcash/initiate.ts
// JazzCash (Pakistan) — signs a Hosted Checkout POST form and returns
// { postUrl, fields } for the client to auto-submit.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { amount, orderId, customer = {} } = body;

    const merchantId    = String(process.env.JAZZCASH_MID      || '').trim();
    const password      = String(process.env.JAZZCASH_PASSWORD || '').trim();
    const integritySalt = String(process.env.JAZZCASH_SALT     || '').trim();
    const sandboxMode =
      process.env.JAZZCASH_SANDBOX !== undefined
        ? String(process.env.JAZZCASH_SANDBOX).toLowerCase() !== 'false'
        : (body.sandboxMode ?? true) !== false;

    if (!merchantId || !password || !integritySalt) {
      return res.status(400).json({ error: 'JazzCash credentials not configured.' });
    }
    if (!amount || !orderId) {
      return res.status(400).json({ error: 'amount and orderId are required.' });
    }

    const postUrl = sandboxMode
      ? 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/'
      : 'https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/';

    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const origin = `${proto}://${req.headers.host}`;

    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const txnDateTime =
      now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
      pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    const expiry = new Date(now.getTime() + 60 * 60 * 1000);
    const expiryDateTime =
      expiry.getFullYear() + pad(expiry.getMonth() + 1) + pad(expiry.getDate()) +
      pad(expiry.getHours()) + pad(expiry.getMinutes()) + pad(expiry.getSeconds());

    const fields: Record<string, string> = {
      pp_Version: '1.1',
      pp_TxnType: 'MWALLET',
      pp_Language: 'EN',
      pp_MerchantID: merchantId,
      pp_SubMerchantID: '',
      pp_Password: password,
      pp_BankID: 'TBANK',
      pp_ProductID: 'RETL',
      pp_TxnRefNo: `T${txnDateTime}${String(orderId).slice(-6)}`,
      pp_Amount: String(Math.round(Number(amount) * 100)),
      pp_TxnCurrency: 'PKR',
      pp_TxnDateTime: txnDateTime,
      pp_BillReference: String(orderId),
      pp_Description: `Order ${orderId}`,
      pp_TxnExpiryDateTime: expiryDateTime,
      pp_ReturnURL: `${origin}/api/jazzcash/callback`,
      pp_SecureHash: '',
      ppmpf_1: customer.name  || '',
      ppmpf_2: customer.email || '',
      ppmpf_3: customer.phone || '',
      ppmpf_4: '',
      ppmpf_5: '',
    };

    const sortedKeys = Object.keys(fields).filter(k => fields[k] !== '' && k !== 'pp_SecureHash').sort();
    const hashString = integritySalt + '&' + sortedKeys.map(k => fields[k]).join('&');
    fields.pp_SecureHash = crypto
      .createHmac('sha256', integritySalt)
      .update(hashString)
      .digest('hex')
      .toUpperCase();

    return res.status(200).json({ success: true, postUrl, fields });
  } catch (e: any) {
    console.error('[jazzcash/initiate]', e);
    return res.status(500).json({ error: e?.message });
  }
}
