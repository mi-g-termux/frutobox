// api/paypal/callback.ts
// PayPal redirects the buyer here after approval or cancellation.
// Passes status back to the SPA via query string so CartModal can finalise the order.

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const { token, status } = req.query; // token = PayPal orderId
  const origin = getOrigin(req);
  if (status === 'cancelled') {
    return res.redirect(302, `${origin}/?paypal=cancelled&orderId=${token || ''}`);
  }
  return res.redirect(302, `${origin}/?paypal=approved&orderId=${token || ''}`);
}

function getOrigin(req: VercelRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  return `${proto}://${req.headers.host}`;
}
