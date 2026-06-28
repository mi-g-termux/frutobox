// lib/payments/easypaisa/initiate.ts
// Easypaisa (Pakistan) — returns a redirectUrl for the hosted EasyPay page.

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { amount, orderId, customer = {} } = body;

    const storeId = String(process.env.EASYPAISA_STORE_ID || '').trim();
    const hashKey = String(process.env.EASYPAISA_HASH_KEY || '').trim();
    const sandboxMode =
      process.env.EASYPAISA_SANDBOX !== undefined
        ? String(process.env.EASYPAISA_SANDBOX).toLowerCase() !== 'false'
        : (body.sandboxMode ?? true) !== false;

    if (!storeId) return res.status(400).json({ error: 'Easypaisa Store ID not configured.' });
    if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId are required.' });

    const baseUrl = sandboxMode
      ? 'https://easypaystg.easypaisa.com.pk/easypay/Index.jsf'
      : 'https://easypay.easypaisa.com.pk/easypay/Index.jsf';

    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const origin = `${proto}://${req.headers.host}`;

    const params = new URLSearchParams({
      storeId: String(storeId),
      amount: Number(amount).toFixed(2),
      postBackURL: `${origin}/api/easypaisa/callback`,
      orderRefNum: String(orderId),
      expiryDate: '',
      merchantHashedReq: hashKey || '',
      autoRedirect: '1',
      paymentMethod: 'MA_PAYMENT_METHOD',
      emailAddr: customer.email || '',
      mobileNum: customer.phone || '',
    });

    return res.status(200).json({ success: true, redirectUrl: `${baseUrl}?${params.toString()}` });
  } catch (e: any) {
    console.error('[easypaisa/initiate]', e);
    return res.status(500).json({ error: e?.message });
  }
}
