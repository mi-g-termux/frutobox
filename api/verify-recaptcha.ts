/**
 * /api/verify-recaptcha
 * Verifies a reCAPTCHA v2 token server-side.
 *
 * The secret key is read from the server environment variable
 * RECAPTCHA_SECRET_KEY — it is NEVER accepted from the client request body.
 * Set this in Vercel / Netlify / Render → Environment Variables and redeploy.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { token } = req.body || {};

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ success: false, message: 'Missing reCAPTCHA token.' });
  }

  // Secret key must come from the server environment — never from the client
  const secretKey = (process.env.RECAPTCHA_SECRET_KEY || '').trim();
  if (!secretKey) {
    // No secret key configured → skip server-side verification and allow through.
    // Admin should set RECAPTCHA_SECRET_KEY in their hosting environment.
    console.warn('[verify-recaptcha] RECAPTCHA_SECRET_KEY not set — skipping server verification.');
    return res.status(200).json({ success: true, warning: 'Server-side verification skipped (RECAPTCHA_SECRET_KEY not configured).' });
  }

  try {
    const params = new URLSearchParams({ secret: secretKey, response: token });
    const verifyRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!verifyRes.ok) {
      return res.status(502).json({ success: false, message: 'reCAPTCHA verification service unavailable.' });
    }

    const data = await verifyRes.json() as { success: boolean; 'error-codes'?: string[] };

    if (data.success) {
      return res.status(200).json({ success: true });
    }

    const codes = data['error-codes'] || [];
    const expired = codes.includes('timeout-or-duplicate');
    return res.status(200).json({
      success: false,
      message: expired
        ? 'reCAPTCHA expired. Please complete the checkbox again.'
        : 'reCAPTCHA verification failed. Please try again.',
    });
  } catch (err: any) {
    console.error('[verify-recaptcha] Error:', err?.message);
    return res.status(500).json({ success: false, message: 'reCAPTCHA verification error.' });
  }
}
