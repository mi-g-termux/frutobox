// api/payment.ts
// ─────────────────────────────────────────────────────────────────────────────
// SINGLE Vercel Serverless Function: routes ALL payment-gateway traffic.
// Fixes: Vercel-safe static imports, comprehensive error logging, edge-case handling.
// ─────────────────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Static imports (no dynamic import() — more reliable on Vercel) ──────────
import bkashCreate from '../lib/payments/bkash/create-payment';
import bkashExecute from '../lib/payments/bkash/execute-payment';
import nagadCreate from '../lib/payments/nagad/create-payment';
import nagadVerify from '../lib/payments/nagad/verify-payment';
import sslcommerzCreate from '../lib/payments/sslcommerz/create-payment';
import sslcommerzIpn from '../lib/payments/sslcommerz/ipn';
import razorpayCreate from '../lib/payments/razorpay/create-order';
import razorpayVerify from '../lib/payments/razorpay/verify-payment';
import paypalCreate from '../lib/payments/paypal/create-order';
import paypalCapture from '../lib/payments/paypal/capture-order';
import paypalCallback from '../lib/payments/paypal/callback';
import stripeCreate from '../lib/payments/stripe/create-payment-intent';
import stripeConfirm from '../lib/payments/stripe/confirm-payment';
import stripeCheckoutSession from '../lib/payments/stripe/create-checkout-session';
import paytmInitiate from '../lib/payments/paytm/initiate';
import paytmCallback from '../lib/payments/paytm/callback';
import upiCreateIntent from '../lib/payments/upi/create-intent';
import jazzcashInitiate from '../lib/payments/jazzcash/initiate';
import jazzcashCallback from '../lib/payments/jazzcash/callback';
import easypaisaInitiate from '../lib/payments/easypaisa/initiate';
import easypaisaCallback from '../lib/payments/easypaisa/callback';
import payfastInitiate from '../lib/payments/payfast/initiate';
import payfastCallback from '../lib/payments/payfast/callback';
import payfastIpn from '../lib/payments/payfast/ipn';

// ── Route map: no lazy loading, direct function references ──────────────────
type Handler = (req: VercelRequest, res: VercelResponse) => unknown;
const ROUTE_MAP: Record<string, Record<string, Handler>> = {
  bkash: {
    'create-payment':  bkashCreate,
    'execute-payment': bkashExecute,
  },
  nagad: {
    'create-payment': nagadCreate,
    'verify-payment': nagadVerify,
  },
  sslcommerz: {
    'create-payment': sslcommerzCreate,
    'ipn':            sslcommerzIpn,
  },
  razorpay: {
    'create-order':   razorpayCreate,
    'verify-payment': razorpayVerify,
  },
  paypal: {
    'create-order':   paypalCreate,
    'capture-order':  paypalCapture,
    'callback':       paypalCallback,
  },
  stripe: {
    'create-payment-intent':   stripeCreate,
    'confirm-payment':         stripeConfirm,
    'create-checkout-session': stripeCheckoutSession,
  },
  paytm: {
    'initiate': paytmInitiate,
    'callback': paytmCallback,
  },
  upi: {
    'create-intent': upiCreateIntent,
  },
  jazzcash: {
    'initiate': jazzcashInitiate,
    'callback': jazzcashCallback,
  },
  easypaisa: {
    'initiate': easypaisaInitiate,
    'callback': easypaisaCallback,
  },
  payfast: {
    'initiate': payfastInitiate,
    'callback': payfastCallback,
    'ipn':      payfastIpn,
  },
};

// ── Main router ──────────────────────────────────────────────────────────────
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const requestId = Math.random().toString(36).slice(2, 8);
  const startTime = Date.now();

  try {
    // CORS pre-flight
    if (req.method === 'OPTIONS') {
      const origin = String(req.headers.origin || '');
      const hostOrigin = `${String(req.headers['x-forwarded-proto'] || 'https')}://${req.headers.host}`;
      const allowed = String(process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
      if (origin && (origin === hostOrigin || allowed.includes(origin))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(204).end();
      return;
    }

    const gateway = normalise(req.query.gateway);
    const action  = normalise(req.query.action);

    console.log(
      `[${requestId}] Payment Router: ${req.method} | gateway=${gateway}, action=${action}`,
    );

    // ─ Validation ─────────────────────────────────────────────────────────
    if (!gateway || !action) {
      console.warn(`[${requestId}] Missing gateway or action`);
      res.status(400).json({
        error: 'Missing query parameters: gateway and action are required.',
        received: { gateway, action },
        example: '/api/payment?gateway=sslcommerz&action=create-payment',
      });
      return;
    }

    // ─ Inline test-connection handler (no gateway-lib import needed) ──────
    if (action === 'test-connection') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const creds: Record<string, string> = (req.body as any)?.credentials || {};

      if (gateway === 'stripe') {
        const { secretKey } = creds;
        if (!secretKey) return void res.json({ success: false, error: 'Secret key is required.' });
        const r = await fetch('https://api.stripe.com/v1/balance', {
          headers: { Authorization: `Bearer ${secretKey}` },
        });
        if (r.ok) return void res.json({ success: true, message: 'Stripe credentials are valid.' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errData = await r.json().catch(() => ({})) as any;
        return void res.json({ success: false, error: errData?.error?.message || 'Invalid Stripe credentials.' });
      }

      if (gateway === 'paypal') {
        const { clientId, clientSecret, sandbox } = creds;
        if (!clientId || !clientSecret) return void res.json({ success: false, error: 'Client ID and Secret are required.' });
        const base = sandbox === 'true' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const r = await fetch(`${base}/v1/oauth2/token`, {
          method: 'POST',
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=client_credentials',
        });
        if (r.ok) return void res.json({ success: true, message: 'PayPal credentials are valid.' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errData = await r.json().catch(() => ({})) as any;
        return void res.json({ success: false, error: errData?.error_description || 'Invalid PayPal credentials.' });
      }

      if (gateway === 'sslcommerz') {
        const { storeId, storePass, sandbox } = creds;
        if (!storeId || !storePass) return void res.json({ success: false, error: 'Store ID and Password are required.' });
        const base = sandbox === 'true' ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com';
        const r = await fetch(`${base}/validator/api/validationserverAPI.php?val_id=test&store_id=${encodeURIComponent(storeId)}&store_passwd=${encodeURIComponent(storePass)}&v=1&format=json`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await r.json().catch(() => ({})) as any;
        const msg = data?.failedreason || data?.status || '';
        if (msg.toLowerCase().includes('inactive') || msg.toLowerCase().includes('unauthorized')) {
          return void res.json({ success: false, error: msg });
        }
        return void res.json({ success: true, message: 'SSLCommerz credentials are reachable.' });
      }

      if (gateway === 'razorpay') {
        const { keyId, keySecret } = creds;
        if (!keyId || !keySecret) return void res.json({ success: false, error: 'Key ID and Key Secret are required.' });
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const r = await fetch('https://api.razorpay.com/v1/payments?count=1', {
          headers: { Authorization: `Basic ${auth}` },
        });
        if (r.ok) return void res.json({ success: true, message: 'Razorpay credentials are valid.' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errData = await r.json().catch(() => ({})) as any;
        return void res.json({ success: false, error: errData?.error?.description || 'Invalid Razorpay credentials.' });
      }

      if (gateway === 'bkash') {
        const { appKey, appSecret, username, password, sandbox } = creds;
        if (!appKey || !appSecret || !username || !password) {
          return void res.json({ success: false, error: 'All four bKash credentials are required.' });
        }
        const base = sandbox === 'true'
          ? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta'
          : 'https://tokenized.pay.bka.sh/v1.2.0-beta';
        const r = await fetch(`${base}/tokenized/checkout/token/grant`, {
          method: 'POST',
          headers: { username, password, 'Content-Type': 'application/json' },
          body: JSON.stringify({ app_key: appKey, app_secret: appSecret }),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await r.json().catch(() => ({})) as any;
        if (data?.statusCode === '0000' || data?.id_token) {
          return void res.json({ success: true, message: 'bKash credentials are valid.' });
        }
        return void res.json({ success: false, error: data?.statusMessage || 'Invalid bKash credentials.' });
      }

      if (gateway === 'nagad') {
        const { merchantId, privateKey } = creds;
        if (!merchantId || !privateKey) return void res.json({ success: false, error: 'Merchant ID and Private Key are required.' });
        const keyOk = privateKey.includes('BEGIN') && privateKey.includes('END');
        if (!keyOk) return void res.json({ success: false, error: 'Private key does not look like a valid PEM RSA key.' });
        return void res.json({ success: true, message: 'Nagad credentials are present and key format looks valid.' });
      }

      // Simple presence checks for remaining gateways
      const simpleChecks: Record<string, { fields: string[]; msg: string }> = {
        paytm:     { fields: ['mid', 'key'],            msg: 'Paytm credentials are saved. Live validation requires a real transaction.' },
        jazzcash:  { fields: ['mid', 'password'],       msg: 'JazzCash credentials are saved. Live validation requires a test transaction.' },
        easypaisa: { fields: ['storeId', 'hashKey'],    msg: 'Easypaisa credentials are saved. Live validation requires a test transaction.' },
        payfast:   { fields: ['merchantId', 'merchantKey'], msg: 'PayFast credentials are saved. Live validation requires a test transaction.' },
      };
      if (simpleChecks[gateway]) {
        const { fields, msg } = simpleChecks[gateway];
        const missing = fields.filter(f => !creds[f]);
        if (missing.length) return void res.json({ success: false, error: `Missing fields: ${missing.join(', ')}` });
        return void res.json({ success: true, message: msg });
      }

      return void res.json({ success: false, error: `Test connection not supported for gateway: ${gateway}` });
    }

    const gatewayActions = ROUTE_MAP[gateway];
    if (!gatewayActions) {
      console.warn(`[${requestId}] Unknown gateway: ${gateway}`);
      res.status(404).json({
        error: `Unknown gateway: "${gateway}"`,
        available: Object.keys(ROUTE_MAP),
      });
      return;
    }

    const handler = gatewayActions[action];
    if (!handler) {
      console.warn(
        `[${requestId}] Unknown action for gateway ${gateway}: ${action}`,
      );
      res.status(404).json({
        error: `Unknown action "${action}" for gateway "${gateway}"`,
        available: Object.keys(gatewayActions),
      });
      return;
    }

    // ─ Invoke the handler ──────────────────────────────────────────────────
    console.log(`[${requestId}] Invoking ${gateway}/${action}...`);
    const result = await handler(req, res);

    const elapsed = Date.now() - startTime;
    console.log(
      `[${requestId}] Success: ${gateway}/${action} completed in ${elapsed}ms`,
    );
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[${requestId}] ERROR after ${elapsed}ms:`, {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Payment router encountered an error',
        message: err?.message ?? 'Unknown error',
        requestId,
      });
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Safely coerce a VercelRequest query value to a plain lowercase string.
 */
function normalise(value: string | string[] | undefined): string {
  if (!value) return '';
  const str = Array.isArray(value) ? value[0] : value;
  if (typeof str !== 'string') return '';
  return str.trim().toLowerCase();
}
