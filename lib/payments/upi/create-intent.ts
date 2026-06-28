// lib/payments/upi/create-intent.ts
// Builds a UPI deep-link / QR payload (upi://pay?...) for India payments.
// No external API call — purely deterministic string assembly + signing-free.

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { amount, orderId, note } = body;

    const upiId     = String(process.env.UPI_VPA        || body.upiId     || '').trim();
    const payeeName = String(process.env.UPI_PAYEE_NAME || body.payeeName || 'Merchant').trim();

    if (!upiId) return res.status(400).json({ error: 'UPI ID (VPA) not configured.' });
    if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId are required.' });

    const params = new URLSearchParams({
      pa: upiId,
      pn: payeeName,
      tr: String(orderId),
      am: Number(amount).toFixed(2),
      cu: 'INR',
      tn: String(note || `Order ${orderId}`),
    });
    const intent = `upi://pay?${params.toString()}`;
    return res.status(200).json({ success: true, intent, qrPayload: intent });
  } catch (e: any) {
    console.error('[upi/create-intent]', e);
    return res.status(500).json({ error: e?.message });
  }
}
