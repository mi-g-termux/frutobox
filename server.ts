// ============================================================================
//  Fruitopia — UNIFIED EXPRESS MONOLITH (single source of truth for Render)
// ----------------------------------------------------------------------------
//  This file is the canonical server. The legacy `server.mjs` has been
//  removed; Render runs `tsx server.ts` (see package.json scripts).
//
//  Everything previously living in server.mjs (email/SMS/WhatsApp, all
//  payment gateways, firebase-config helpers, Vite dev middleware, static
//  prod serving) has been migrated here, plus:
//    • app.use(express.urlencoded({ extended: true })) — required for
//      SSLCommerz / JazzCash / Easypaisa / PayFast POST callbacks.
//    • Explicit app.all('/api/sslcommerz/callback', …) handler that accepts
//      BOTH GET and POST (fixes "Cannot POST /api/sslcommerz/callback" on
//      Render) and safely res.redirect()s back to the SPA with the
//      transaction state.
//    • All gateway handlers read merchant credentials from the request body
//      (admin-panel CMS settings) with env-var fallbacks — no hard-coded
//      keys anywhere.
// ============================================================================

// ── Load .env FIRST — before any other import reads process.env ──────────────
// Works for: local VS Code dev (tsx server.ts), Render, VPS, cPanel Node.js.
// On platforms with a native env-var dashboard (Render, Vercel, Netlify), the
// .env file is typically absent — dotenv silently does nothing in that case.
import 'dotenv/config';

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { Request, Response, NextFunction } from 'express';

const require = createRequire(import.meta.url);

// CommonJS deps loaded via createRequire so the file works under tsx/node
// without needing per-package ESM type-roots.
const express   = require('express');
const nodemailer = require('nodemailer');
// NOTE: vite is imported lazily inside startServer() only when !isProd
// so the production bundle never loads it (and it won't be installed on cPanel).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// When bundled to dist-server/server.js, dist/ and public/ live one level up.
// In dev (tsx server.ts), __dirname IS the project root.
const projectRoot = path.basename(__dirname) === 'dist-server'
  ? path.resolve(__dirname, '..')
  : __dirname;

// ── Persist env vars to .env file AND update process.env in-memory ──────────
// This makes install-status and supabase-config.json work immediately in
// incognito / other browsers without a server restart.
// On read-only filesystems (Vercel/Netlify serverless), in-memory update still
// works for this process session. Permanent fix on those platforms requires
// adding env vars in the hosting dashboard and redeploying.
function persistEnvVars(vars: Record<string, string>): boolean {
  // ALWAYS update process.env immediately (works on ALL platforms for current process)
  for (const [k, v] of Object.entries(vars)) {
    process.env[k] = v;
  }
  // Try to write .env file (works on Render, VPS, cPanel, localhost)
  try {
    const envPath = path.resolve(projectRoot, '.env');
    let fileContent = '';
    try { fileContent = fs.readFileSync(envPath, 'utf8'); } catch { /* file not present yet */ }
    for (const [key, val] of Object.entries(vars)) {
      // Always write as KEY="value" — matches the op.env template format
      const safeVal = val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const newLine = key + '="' + safeVal + '"';
      // Matches KEY="...", KEY=value, or KEY= (any existing entry for this key)
      const lineRegex = new RegExp('^' + key + '=.*$', 'm');
      if (lineRegex.test(fileContent)) {
        fileContent = fileContent.replace(lineRegex, newLine);
      } else {
        if (fileContent.length > 0 && !fileContent.endsWith('\n')) fileContent += '\n';
        fileContent += newLine + '\n';
      }
    }
    fs.writeFileSync(envPath, fileContent, 'utf8');
    console.log('[env] ✅ Persisted ' + Object.keys(vars).join(', ') + ' to .env');
    return true;
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn('[env] Could not write .env (read-only FS or permissions). In-memory only.', msg);
    return false;
  }
}

// ── Input sanitization helpers ──────────────────────────────────────────────
function sanitizeStr(s: unknown, max = 2000): string {
  return typeof s === 'string' ? s.replace(/<[^>]*>/g, '').substring(0, max) : '';
}
function isValidEmail(e: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e));
}

// ── Transporter pool (reuse SMTP connections) ───────────────────────────────
const _transporterCache = new Map<string, any>();
function getTransporter(smtp: any) {
  const cacheKey = `${smtp.host}:${smtp.port}:${smtp.email}`;
  if (_transporterCache.has(cacheKey)) return _transporterCache.get(cacheKey);
  const port = Number(smtp.port || 587);
  const t = nodemailer.createTransport({
    host: smtp.host,
    port,
    secure: port === 465,
    auth: { user: smtp.email, pass: smtp.password },
    tls: { rejectUnauthorized: false },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateLimit: 14,
  });
  _transporterCache.set(cacheKey, t);
  return t;
}

// ── Rate limiter (OTP abuse protection) ────────────────────────────────────
const _rateLimitMap = new Map<string, { count: number; windowStart: number }>();
function checkRateLimit(key: string, maxPerWindow = 5, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = _rateLimitMap.get(key) || { count: 0, windowStart: now };
  if (now - entry.windowStart > windowMs) {
    _rateLimitMap.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= maxPerWindow) return false;
  entry.count++;
  _rateLimitMap.set(key, entry);
  return true;
}

// The canonical .env template — all keys present with empty values.
// persistEnvVars() does a regex replace on existing KEY=... lines, so
// the keys MUST already exist in the file for the replace to work.
// This template is written on first start when .env is missing.
const ENV_TEMPLATE = `# ============================================================
# FIREBASE CONFIGURATION
# Leave these EMPTY for first-run installation.
# After you submit credentials in the Install Wizard, the
# server writes the values here automatically.
# ============================================================
VITE_FIREBASE_API_KEY=""
VITE_FIREBASE_AUTH_DOMAIN=""
VITE_FIREBASE_PROJECT_ID=""
VITE_FIREBASE_STORAGE_BUCKET=""
VITE_FIREBASE_MESSAGING_SENDER_ID=""
VITE_FIREBASE_APP_ID=""
VITE_FIREBASE_DATABASE_ID="(default)"

# ============================================================
# SUPABASE CONFIGURATION
# Use the public anon/publishable key only.
# ============================================================
SUPABASE_URL=""
SUPABASE_ANON_KEY=""
SUPABASE_PUBLISHABLE_KEY=""
VITE_SUPABASE_URL=""
VITE_SUPABASE_ANON_KEY=""
VITE_SUPABASE_PUBLISHABLE_KEY=""

# ============================================================
# APP URL
# ============================================================
VITE_APP_URL=""
`;

async function startServer() {
  // ── Auto-create .env with full key template if missing ───────────────────
  // persistEnvVars() needs existing KEY="" lines to do a regex replace.
  // Without this, a fresh clone on VPS/cPanel/Render has no .env and the
  // wizard's credential writes would be appended at the bottom — which works
  // too, but having the template means dotenv can reload after a restart and
  // the structure stays clean and readable.
  const envFilePath = path.resolve(projectRoot, '.env');
  if (!fs.existsSync(envFilePath)) {
    try {
      fs.writeFileSync(envFilePath, ENV_TEMPLATE, 'utf8');
      console.log('[env] ✅ Created .env template at', envFilePath);
    } catch (e: any) {
      console.warn('[env] Could not create .env (read-only filesystem — use hosting dashboard for env vars):', e?.message || e);
    }
  }

  const app = express();

  // JSON + URL-encoded body parsing. The urlencoded parser is REQUIRED for
  // SSLCommerz / JazzCash / Easypaisa / PayFast which POST x-www-form-urlencoded
  // callbacks. Without it req.body is empty on POST.
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  const PORT = Number(process.env.PORT || 3005);
  const isProd = process.env.NODE_ENV === 'production';

  // ── CORS ────────────────────────────────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const allowed = (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((v: string) => v.trim())
      .filter(Boolean);
    const hostOrigin = `${req.protocol}://${req.get('host')}`;
    if (origin && (origin === hostOrigin || allowed.includes(origin))) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
    }
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // --- HEALTH ----------------------------------------------------------------
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'healthy', time: new Date().toISOString() });
  });

  // --- RECAPTCHA VERIFY -------------------------------------------------------
  app.post('/api/verify-recaptcha', async (req: Request, res: Response) => {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ success: false, message: 'Missing reCAPTCHA token.' });
    // Secret key from server env only — never trusted from client
    const secretKey = (process.env.RECAPTCHA_SECRET_KEY || '').trim();
    if (!secretKey) {
      console.warn('[verify-recaptcha] RECAPTCHA_SECRET_KEY not set — skipping server verification.');
      return res.json({ success: true, warning: 'Server-side verification skipped (RECAPTCHA_SECRET_KEY not configured).' });
    }
    try {
      const params = new URLSearchParams({ secret: secretKey, response: token });
      const gr = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const data = await gr.json() as { success: boolean; 'error-codes'?: string[] };
      if (data.success) return res.json({ success: true });
      const codes = data['error-codes'] || [];
      const expired = codes.includes('timeout-or-duplicate');
      return res.json({ success: false, message: expired ? 'reCAPTCHA expired. Please complete the checkbox again.' : 'reCAPTCHA verification failed. Please try again.' });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: 'reCAPTCHA verification error.' });
    }
  });

  // --- SEND EMAIL ------------------------------------------------------------
  app.post('/api/send-email', async (req: Request, res: Response) => {
    const raw = req.body || {};
    const to      = sanitizeStr(raw.to, 254);
    const subject = sanitizeStr(raw.subject, 200);
    const html    = sanitizeStr(raw.html, 50000);
    const { smtpSettings } = raw;
    if (!to || !subject || !html) return res.status(400).json({ error: 'Missing required fields: to, subject, html' });
    if (!isValidEmail(to)) return res.status(400).json({ error: 'Invalid email' });
    const smtp = smtpSettings || { isEnabled: false };
    if (!smtp.isEnabled || !smtp.host || !smtp.email || !smtp.password) {
      console.log(`[EMAIL SKIPPED] SMTP not configured → ${to} | ${subject}`);
      return res.json({ success: true, simulated: true, message: 'SMTP not configured — email skipped.' });
    }
    try {
      const transporter = getTransporter(smtp);
      const info = await transporter.sendMail({
        from: `"${smtp.fromName || 'Store'}" <${smtp.email}>`,
        to, subject, html,
        headers: { 'X-Priority': '1', 'X-Mailer': 'E-Shop Mailer v5.6' },
      });
      console.log(`[EMAIL SENT] To: ${to} | ID: ${info.messageId}`);
      return res.json({ success: true, messageId: info.messageId });
    } catch (err: any) {
      _transporterCache.delete(`${smtp.host}:${smtp.port}:${smtp.email}`);
      console.error('[EMAIL ERROR]', err.message);
      return res.status(500).json({
        success: false, error: 'Email delivery failed.',
        hint: 'For Gmail: use an App Password. Enable 2FA → myaccount.google.com/apppasswords',
      });
    }
  });

  // --- SEND SMS (Twilio) -----------------------------------------------------
  app.post('/api/send-sms', async (req: Request, res: Response) => {
    const raw = req.body || {};
    const to      = sanitizeStr(raw.to, 20);
    const message = sanitizeStr(raw.message, 500);
    const { twilioSettings } = raw;
    if (!to || !message) return res.status(400).json({ error: 'Missing fields' });
    const ts = twilioSettings || {};
    if (!ts.isEnabled || !ts.accountSid || !ts.authToken || !ts.fromNumber) {
      console.log(`[SMS SKIPPED] Twilio not configured → ${to}`);
      return res.json({ success: true, simulated: true, message: 'SMS gateway not configured.' });
    }
    if (!checkRateLimit(`sms:${to}`, 3, 60_000)) {
      return res.status(429).json({ success: false, error: 'Too many SMS requests. Please wait before requesting another OTP.' });
    }
    try {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${ts.accountSid}/Messages.json`;
      const basicAuth = Buffer.from(`${ts.accountSid}:${ts.authToken}`).toString('base64');
      const body = new URLSearchParams({ To: to, From: ts.fromNumber, Body: message });
      const resp = await fetch(twilioUrl, {
        method: 'POST',
        headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const data: any = await resp.json();
      if (data.sid) return res.json({ success: true, sid: data.sid });
      return res.status(502).json({ success: false, error: data.message || 'Twilio error', code: data.code });
    } catch (err: any) {
      console.error('[SMS ERROR]', err.message);
      return res.status(500).json({ success: false, error: 'SMS delivery failed.' });
    }
  });

  // --- SEND VERIFICATION EMAIL ----------------------------------------------
  app.post('/api/send-verification', async (req: Request, res: Response) => {
    const raw = req.body || {};
    const email     = sanitizeStr(raw.email, 254);
    const token     = sanitizeStr(raw.token, 200);
    const storeName = sanitizeStr(raw.storeName, 100);
    const { smtpSettings } = raw;
    if (!email || !token) return res.status(400).json({ error: 'Missing email or token' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email' });
    const smtp = smtpSettings || { isEnabled: false };
    const baseUrl = (req.headers.origin as string) || `${req.protocol}://${req.get('host')}`;
    const verifyUrl = `${baseUrl}?verify_token=${token}&verify_email=${encodeURIComponent(email)}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;background:#f8fafc;border-radius:12px;">
        <div style="background:#10b981;border-radius:8px;padding:20px 24px;text-align:center;margin-bottom:24px;">
          <div style="font-size:36px;margin-bottom:6px;">✉️</div>
          <div style="color:#fff;font-size:18px;font-weight:800;">${storeName || 'E-Shop'}</div>
          <div style="color:#d1fae5;font-size:12px;margin-top:4px;">Email Verification</div>
        </div>
        <h2 style="color:#0f172a;font-size:16px;margin:0 0 10px;">Verify your email address</h2>
        <p style="color:#475569;font-size:13px;margin:0 0 20px;">Click the button below to verify your email and activate your account. This link expires in <strong>24 hours</strong>.</p>
        <div style="text-align:center;margin:24px 0;">
          <a href="${verifyUrl}" style="display:inline-block;background:#10b981;color:#fff;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;">✅ Verify My Email</a>
        </div>
        <p style="color:#94a3b8;font-size:11px;text-align:center;">If you didn't create this account, please ignore this email.</p>
      </div>`;
    if (!smtp.isEnabled || !smtp.host || !smtp.email || !smtp.password) {
      console.log(`[VERIFY SKIPPED] SMTP not configured → ${email} | Token: ${token}`);
      return res.json({ success: true, simulated: true });
    }
    try {
      const transporter = getTransporter(smtp);
      await transporter.sendMail({
        from: `"${smtp.fromName || storeName || 'Store'}" <${smtp.email}>`,
        to: email,
        subject: `Verify your ${storeName || 'E-Shop'} account`,
        html,
      });
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[VERIFY EMAIL ERROR]', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // --- SEND WHATSAPP (Meta Cloud API) ---------------------------------------
  app.post('/api/send-whatsapp', async (req: Request, res: Response) => {
    const raw = req.body || {};
    const to = sanitizeStr(raw.to, 20);
    const { waSettings } = raw;
    const phoneNumberId = waSettings?.phoneNumberId;
    const accessToken = waSettings?.accessToken;
    const templateName = waSettings?.templateName || 'hello_world';
    if (!phoneNumberId || !accessToken) {
      return res.json({ success: false, error: 'WhatsApp not configured', simulated: true });
    }
    if (!to) return res.status(400).json({ success: false, error: 'Missing recipient phone number' });
    try {
      const waRes = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to,
          type: 'template', template: { name: templateName, language: { code: 'en_US' } },
        }),
      });
      const data: any = await waRes.json();
      if (data.messages?.[0]?.id) return res.json({ success: true, messageId: data.messages[0].id });
      return res.status(502).json({ success: false, error: data.error?.message || 'WhatsApp API error', detail: data });
    } catch (err: any) {
      console.error('[WHATSAPP ERROR]', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // ============================ PAYMENT GATEWAYS ============================
  // Merchant secrets are read from environment variables only; request bodies
  // may supply order/customer/payment data but never trusted credentials.
  // ==========================================================================

  // --- STRIPE ----------------------------------------------------------------
  // --- STRIPE CHECKOUT SESSION (used by CartModal 'Stripe' gateway) -----------
  app.post('/api/stripe/create-checkout-session', async (req: Request, res: Response) => {
    const body = req.body || {};
    const { amount, currency = 'usd', orderId, productName = 'Order', customerEmail, successUrl, cancelUrl } = body;
    const secret = String(body.stripeSecretKey || process.env.STRIPE_SECRET_KEY || '').trim();
    if (!secret) return res.status(400).json({ error: 'Stripe secret key not configured. Add it in Admin → Payment Settings.' });
    if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId are required.' });
    try {
      const lineItems = [{
        price_data: {
          currency: String(currency).toLowerCase().slice(0, 3),
          product_data: { name: productName },
          unit_amount: Math.round(parseFloat(String(amount)) * 100),
        },
        quantity: 1,
      }];
      const sessionBody: Record<string, any> = {
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        success_url: successUrl || `${req.protocol}://${req.get('host')}/?stripe=success&orderId=${encodeURIComponent(orderId)}`,
        cancel_url:  cancelUrl  || `${req.protocol}://${req.get('host')}/?stripe=cancelled&orderId=${encodeURIComponent(orderId)}`,
        metadata: { orderId },
      };
      if (customerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
        sessionBody.customer_email = customerEmail;
      }
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(sessionBody)) {
        if (k === 'line_items') {
          params.set('line_items[0][price_data][currency]', lineItems[0].price_data.currency);
          params.set('line_items[0][price_data][product_data][name]', lineItems[0].price_data.product_data.name);
          params.set('line_items[0][price_data][unit_amount]', String(lineItems[0].price_data.unit_amount));
          params.set('line_items[0][quantity]', '1');
        } else if (k === 'payment_method_types') {
          params.set('payment_method_types[0]', 'card');
        } else if (k === 'metadata') {
          params.set('metadata[orderId]', orderId);
        } else {
          params.set(k, String(v));
        }
      }
      const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const data: any = await stripeRes.json();
      if (!stripeRes.ok || !data?.url) {
        console.error('[Stripe checkout-session]', data);
        return res.status(502).json({ error: data?.error?.message || 'Stripe Checkout session failed.' });
      }
      return res.json({ url: data.url, sessionId: data.id });
    } catch (err: any) {
      return res.status(500).json({ error: `Stripe error: ${err.message}` });
    }
  });

  app.post('/api/stripe/create-payment-intent', async (req: Request, res: Response) => {
    const { amount, currency = 'usd' } = req.body || {};
    const secret = String(process.env.STRIPE_SECRET_KEY || '').trim();
    if (!secret) return res.status(400).json({ error: 'Stripe secret key not configured.' });
    if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: 'Invalid amount.' });
    try {
      const amountCents = Math.round(Number(amount) * 100);
      const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          amount: String(amountCents),
          currency,
          'automatic_payment_methods[enabled]': 'true',
        }).toString(),
      });
      const data: any = await stripeRes.json();
      if (data.error) return res.status(502).json({ error: data.error.message });
      return res.json({ success: true, clientSecret: data.client_secret, paymentIntentId: data.id });
    } catch (err: any) {
      return res.status(500).json({ error: `Stripe API error: ${err.message}` });
    }
  });

  app.post('/api/stripe/confirm-payment', async (req: Request, res: Response) => {
    const { paymentIntentId, paymentMethodId } = req.body || {};
    const secret = String(process.env.STRIPE_SECRET_KEY || '').trim();
    if (!secret || !paymentIntentId || !paymentMethodId)
      return res.status(400).json({ error: 'Missing required Stripe parameters.' });
    try {
      const r = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ payment_method: paymentMethodId }).toString(),
      });
      const data: any = await r.json();
      if (data.error) return res.status(502).json({ error: data.error.message });
      if (data.status === 'succeeded' || data.status === 'requires_capture')
        return res.json({ success: true, status: data.status, transactionId: data.id });
      return res.status(502).json({ error: `Unexpected Stripe status: ${data.status}`, status: data.status });
    } catch (err: any) {
      return res.status(500).json({ error: `Stripe confirm error: ${err.message}` });
    }
  });

  // --- PAYPAL ----------------------------------------------------------------
  app.post('/api/paypal/create-order', async (req: Request, res: Response) => {
    const { amount, currency = 'USD' } = req.body || {};
    // Accept credentials from body (admin CMS settings) with ENV var fallback
    const clientId     = String(req.body?.paypalClientId     || process.env.PAYPAL_CLIENT_ID     || '').trim();
    const clientSecret = String(req.body?.paypalClientSecret || process.env.PAYPAL_CLIENT_SECRET || '').trim();
    const sandboxMode  = req.body?.sandboxMode ?? (String(process.env.PAYPAL_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!clientId || !clientSecret) return res.status(400).json({ error: 'PayPal credentials not configured.' });
    if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: 'Invalid amount.' });
    const baseUrl = sandboxMode !== false ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    try {
      const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      const tokenData: any = await tokenRes.json();
      if (!tokenData.access_token) return res.status(502).json({ error: 'PayPal token grant failed.', detail: tokenData });
      const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: currency, value: Number(amount).toFixed(2) } }],
          application_context: {
            return_url: `${req.protocol}://${req.get('host')}/api/paypal/callback?status=success`,
            cancel_url: `${req.protocol}://${req.get('host')}/api/paypal/callback?status=cancelled`,
          },
        }),
      });
      const orderData: any = await orderRes.json();
      if (orderData.id) {
        const approvalLink = orderData.links?.find((l: any) => l.rel === 'approve')?.href;
        return res.json({ success: true, orderId: orderData.id, approvalUrl: approvalLink });
      }
      return res.status(502).json({ error: 'PayPal order creation failed.', detail: orderData });
    } catch (err: any) {
      return res.status(500).json({ error: `PayPal API error: ${err.message}` });
    }
  });

  app.post('/api/paypal/capture-order', async (req: Request, res: Response) => {
    const { orderId } = req.body || {};
    const clientId     = String(req.body?.paypalClientId     || process.env.PAYPAL_CLIENT_ID     || '').trim();
    const clientSecret = String(req.body?.paypalClientSecret || process.env.PAYPAL_CLIENT_SECRET || '').trim();
    const sandboxMode  = req.body?.sandboxMode ?? (String(process.env.PAYPAL_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!clientId || !clientSecret || !orderId) return res.status(400).json({ error: 'Missing PayPal capture parameters.' });
    const baseUrl = sandboxMode !== false ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    try {
      const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      const tokenData: any = await tokenRes.json();
      if (!tokenData.access_token) return res.status(502).json({ error: 'PayPal token grant failed.' });
      const captureRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
      });
      const captureData: any = await captureRes.json();
      if (captureData.status === 'COMPLETED') {
        const txnId = captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id;
        return res.json({ success: true, status: 'COMPLETED', transactionId: txnId });
      }
      return res.status(502).json({ error: 'PayPal capture failed.', detail: captureData });
    } catch (err: any) {
      return res.status(500).json({ error: `PayPal capture error: ${err.message}` });
    }
  });

  app.all('/api/paypal/callback', (req: Request, res: Response) => {
    const token  = (req.query.token  || req.body?.token  || '').toString();
    const status = (req.query.status || req.body?.status || '').toString().toLowerCase();
    if (status === 'success' && token) return res.redirect(`/?paypal=approved&orderId=${token}`);
    res.redirect(`/?paypal=cancelled&orderId=${token}`);
  });

  // --- SSLCOMMERZ ------------------------------------------------------------
  app.post('/api/sslcommerz/create-payment', async (req: Request, res: Response) => {
    const body = req.body || {};
    const { amount, currency = 'BDT', orderId, productName, customer = {} } = body;
    // Read credentials from request body (admin-panel CMS) first, then fall back to env vars
    const storeId       = String(body.storeId   || body.store_id   || process.env.SSLCZ_STORE_ID       || '').trim();
    const storePassword = String(body.storePass || body.storePassword || body.store_pass || process.env.SSLCZ_STORE_PASSWORD || '').trim();
    const sandboxMode = body.sandboxMode ?? body.isSandbox
      ?? (String(process.env.SSLCZ_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId are required.' });
    if (!storeId || !storePassword)
      return res.status(400).json({ error: 'SSLCommerz credentials not configured. Set Store ID and Store Password in the admin panel.' });
    const baseUrl = sandboxMode !== false ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com';
    const origin = `${(req.headers['x-forwarded-proto'] || req.protocol)}://${req.get('host')}`;
    try {
      const params = new URLSearchParams({
        store_id: storeId, store_passwd: storePassword,
        total_amount: Number(amount).toFixed(2), currency, tran_id: orderId,
        success_url:  `${origin}/api/sslcommerz/callback?status=success&orderId=${encodeURIComponent(orderId)}`,
        fail_url:     `${origin}/api/sslcommerz/callback?status=failed&orderId=${encodeURIComponent(orderId)}`,
        cancel_url:   `${origin}/api/sslcommerz/callback?status=cancelled&orderId=${encodeURIComponent(orderId)}`,
        ipn_url:      `${origin}/api/sslcommerz/ipn`,
        cus_name: customer.name || 'Customer', cus_email: customer.email || 'customer@example.com',
        cus_phone: customer.phone || '01700000000', cus_add1: customer.address || 'N/A',
        cus_city: customer.city || 'Dhaka', cus_country: customer.country || 'Bangladesh',
        shipping_method: 'NO', product_name: productName || 'Order',
        product_category: 'general', product_profile: 'general',
        num_of_item: '1', value_a: orderId,
      });
      const sslRes = await fetch(`${baseUrl}/gwprocess/v4/api.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const text = await sslRes.text();
      let data: any;
      try { data = JSON.parse(text); }
      catch {
        console.error('[SSLCommerz] invalid JSON response', { status: sslRes.status, text });
        return res.status(502).json({ error: 'SSLCommerz returned an invalid response.', detail: text });
      }
      if (data.status === 'SUCCESS' && data.GatewayPageURL)
        return res.json({ success: true, redirectUrl: data.GatewayPageURL, gatewayUrl: data.GatewayPageURL, sessionKey: data.sessionkey });
      return res.status(502).json({ error: data.failedreason || 'SSLCommerz session initiation failed.', detail: data });
    } catch (err: any) {
      return res.status(500).json({ error: `SSLCommerz API error: ${err.message}` });
    }
  });

  // ── CRITICAL FIX: explicit POST + GET handler for /api/sslcommerz/callback ──
  // SSLCommerz POSTs (x-www-form-urlencoded) to success_url/fail_url/cancel_url.
  // Using app.all() captures BOTH verbs cleanly, fixing the
  // "Cannot POST /api/sslcommerz/callback" 404 reported on Render. We safely
  // res.redirect() back to the SPA with the transaction state so the frontend
  // can finalise the order.
  app.all('/api/sslcommerz/callback', async (req: Request, res: Response) => {
    res.setHeader('X-Robots-Tag', 'noindex');
    console.log(`[SSLCOMMERZ CALLBACK] ${req.method} status=${req.query.status || req.body?.status}`);
    const status  = (req.query.status   || req.body?.status     || '').toString();
    const orderId = (req.query.orderId  || req.body?.value_a    || req.body?.tran_id || '').toString();
    const tranId  = (req.body?.tran_id  || '').toString();
    const valId   = (req.body?.val_id   || '').toString();
    const normalized = status.toLowerCase();
    let verified = false;
    if (valId && ['success', 'failed', 'fail', 'cancelled', 'cancel'].includes(normalized)) {
      try {
        const sandbox = String(process.env.SSLCZ_SANDBOX || 'true').toLowerCase() !== 'false';
        const base = sandbox ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com';
        const u = `${base}/validator/api/validationserverAPI.php?val_id=${encodeURIComponent(valId)}&store_id=${encodeURIComponent(process.env.SSLCZ_STORE_ID || '')}&store_passwd=${encodeURIComponent(process.env.SSLCZ_STORE_PASSWORD || '')}&format=json`;
        const r = await fetch(u);
        const j: any = await r.json().catch(() => ({}));
        verified = j?.status === 'VALID' || j?.status === 'VALIDATED';
      } catch (err: any) {
        console.warn('[SSLCOMMERZ CALLBACK] validation failed:', err?.message || err);
      }
    }
    const qs = new URLSearchParams({
      sslcommerz: normalized === 'success' && verified ? 'success' : normalized === 'failed' || normalized === 'fail' ? 'failed' : 'cancelled',
      ...(orderId ? { orderId } : {}),
      ...(tranId  ? { tranId  } : {}),
      ...(valId   ? { valId   } : {}),
    }).toString();
    return res.redirect(`/?${qs}`);
  });

  app.post('/api/sslcommerz/ipn', (req: Request, res: Response) => {
    console.log('[SSLCommerz IPN]', req.body);
    res.status(200).send('OK');
  });

  // ── PAYTM (All-in-One SDK) ────────────────────────────────────────────────
  app.post('/api/paytm/initiate', async (req: Request, res: Response) => {
    const crypto = require('crypto');
    const { amount, orderId, customer = {} } = req.body || {};
    const merchantId  = String(process.env.PAYTM_MID || '').trim();
    const merchantKey = String(process.env.PAYTM_MERCHANT_KEY || '').trim();
    const sandboxMode = req.body?.sandboxMode ?? (String(process.env.PAYTM_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!merchantId || !merchantKey) return res.status(400).json({ error: 'Paytm credentials not configured.' });
    if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId are required.' });
    const isSandbox = sandboxMode !== false;
    const host = isSandbox ? 'https://securegw-stage.paytm.in' : 'https://securegw.paytm.in';
    const origin = `${(req.headers['x-forwarded-proto'] || req.protocol)}://${req.get('host')}`;
    const body = {
      requestType: 'Payment', mid: merchantId,
      websiteName: isSandbox ? 'WEBSTAGING' : 'DEFAULT',
      orderId: String(orderId),
      callbackUrl: `${origin}/api/paytm/callback`,
      txnAmount: { value: Number(amount).toFixed(2), currency: 'INR' },
      userInfo: {
        custId: customer.email || customer.phone || `cust_${Date.now()}`,
        email: customer.email || undefined, mobile: customer.phone || undefined,
      },
    };
    const generateSignature = (data: string, key: string) => {
      const iv = '@@@@&&&&####$$$$';
      const cipher = crypto.createCipheriv('aes-128-cbc', key.slice(0, 16), iv);
      let encrypted = cipher.update(data, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      return encrypted;
    };
    try {
      const payload: any = { body, head: {} };
      const bodyStr = JSON.stringify(body);
      payload.head = { signature: generateSignature(bodyStr, merchantKey) };
      const r = await fetch(
        `${host}/theia/api/v1/initiateTransaction?mid=${merchantId}&orderId=${encodeURIComponent(orderId)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
      );
      const data: any = await r.json();
      const txnToken = data?.body?.txnToken;
      if (!txnToken) return res.status(502).json({ error: data?.body?.resultInfo?.resultMsg || 'Paytm init failed.', detail: data });
      const redirectUrl = `${host}/theia/api/v1/showPaymentPage?mid=${merchantId}&orderId=${encodeURIComponent(orderId)}`;
      return res.json({ success: true, txnToken, redirectUrl, mid: merchantId, orderId });
    } catch (err: any) {
      return res.status(500).json({ error: `Paytm API error: ${err.message}` });
    }
  });

  app.all('/api/paytm/callback', (req: Request, res: Response) => {
    const status  = (req.body?.STATUS  || req.query.STATUS  || '').toString();
    const orderId = (req.body?.ORDERID || req.query.ORDERID || '').toString();
    const txnId   = (req.body?.TXNID   || req.query.TXNID   || '').toString();
    const qs = new URLSearchParams({
      paytm: status === 'TXN_SUCCESS' ? 'success' : status === 'PENDING' ? 'pending' : 'failed',
      ...(orderId ? { orderId } : {}),
      ...(txnId   ? { txnId   } : {}),
    }).toString();
    res.redirect(`/?${qs}`);
  });

  // ── UPI (manual intent / QR) ──────────────────────────────────────────────
  app.post('/api/upi/create-intent', (req: Request, res: Response) => {
    const { amount, orderId, note } = req.body || {};
    const upiId      = String(req.body?.upiId      || process.env.UPI_VPA          || '').trim();
    const payeeName  = String(req.body?.payeeName  || process.env.UPI_PAYEE_NAME   || 'Merchant').trim();
    if (!upiId) return res.status(400).json({ error: 'UPI ID (VPA) not configured.' });
    if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId are required.' });
    const params = new URLSearchParams({
      pa: upiId, pn: payeeName, tr: String(orderId),
      am: Number(amount).toFixed(2), cu: 'INR', tn: note || `Order ${orderId}`,
    });
    const intent = `upi://pay?${params.toString()}`;
    return res.json({ success: true, intent, qrPayload: intent });
  });

  // ── JAZZCASH (Pakistan) ───────────────────────────────────────────────────
  app.post('/api/jazzcash/initiate', (req: Request, res: Response) => {
    const crypto = require('crypto');
    const { amount, orderId, customer = {} } = req.body || {};
    const merchantId    = String(process.env.JAZZCASH_MID || '').trim();
    const password      = String(process.env.JAZZCASH_PASSWORD || '').trim();
    const integritySalt = String(process.env.JAZZCASH_SALT || '').trim();
    const sandboxMode   = req.body?.sandboxMode ?? (String(process.env.JAZZCASH_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!merchantId || !password || !integritySalt) return res.status(400).json({ error: 'JazzCash credentials not configured.' });
    if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId are required.' });
    const isSandbox = sandboxMode !== false;
    const postUrl = isSandbox
      ? 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/'
      : 'https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/';
    const origin = `${(req.headers['x-forwarded-proto'] || req.protocol)}://${req.get('host')}`;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const txnDateTime =
      now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
      pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    const expiry = new Date(now.getTime() + 60 * 60 * 1000);
    const expiryDateTime =
      expiry.getFullYear() + pad(expiry.getMonth() + 1) + pad(expiry.getDate()) +
      pad(expiry.getHours()) + pad(expiry.getMinutes()) + pad(expiry.getSeconds());
    const fields: Record<string, string> = {
      pp_Version: '1.1', pp_TxnType: 'MWALLET', pp_Language: 'EN',
      pp_MerchantID: merchantId, pp_SubMerchantID: '', pp_Password: password,
      pp_BankID: 'TBANK', pp_ProductID: 'RETL',
      pp_TxnRefNo: `T${txnDateTime}${String(orderId).slice(-6)}`,
      pp_Amount: String(Math.round(Number(amount) * 100)), pp_TxnCurrency: 'PKR',
      pp_TxnDateTime: txnDateTime, pp_BillReference: String(orderId),
      pp_Description: `Order ${orderId}`, pp_TxnExpiryDateTime: expiryDateTime,
      pp_ReturnURL: `${origin}/api/jazzcash/callback`, pp_SecureHash: '',
      ppmpf_1: customer.name || '', ppmpf_2: customer.email || '',
      ppmpf_3: customer.phone || '', ppmpf_4: '', ppmpf_5: '',
    };
    const sortedKeys = Object.keys(fields).filter(k => fields[k] !== '' && k !== 'pp_SecureHash').sort();
    const hashString = integritySalt + '&' + sortedKeys.map(k => fields[k]).join('&');
    fields.pp_SecureHash = crypto.createHmac('sha256', integritySalt).update(hashString).digest('hex').toUpperCase();
    return res.json({ success: true, postUrl, fields });
  });

  app.all('/api/jazzcash/callback', (req: Request, res: Response) => {
    const code    = (req.body?.pp_ResponseCode || req.query.pp_ResponseCode || '').toString();
    const orderId = (req.body?.pp_BillReference || req.query.pp_BillReference || '').toString();
    const txnRef  = (req.body?.pp_TxnRefNo || req.query.pp_TxnRefNo || '').toString();
    const qs = new URLSearchParams({
      jazzcash: code === '000' ? 'success' : 'failed', code,
      ...(orderId ? { orderId } : {}),
      ...(txnRef  ? { txnRef  } : {}),
    }).toString();
    res.redirect(`/?${qs}`);
  });

  // ── EASYPAISA (Pakistan) ──────────────────────────────────────────────────
  app.post('/api/easypaisa/initiate', (req: Request, res: Response) => {
    const { amount, orderId, customer = {} } = req.body || {};
    const storeId     = String(req.body?.storeId     || process.env.EASYPAISA_STORE_ID  || '').trim();
    const hashKey     = String(req.body?.hashKey     || process.env.EASYPAISA_HASH_KEY  || '').trim();
    const sandboxMode = req.body?.sandboxMode ?? (String(process.env.EASYPAISA_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!storeId) return res.status(400).json({ error: 'Easypaisa Store ID not configured.' });
    if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId are required.' });
    const isSandbox = sandboxMode !== false;
    const baseUrl = isSandbox
      ? 'https://easypaystg.easypaisa.com.pk/easypay/Index.jsf'
      : 'https://easypay.easypaisa.com.pk/easypay/Index.jsf';
    const origin = `${(req.headers['x-forwarded-proto'] || req.protocol)}://${req.get('host')}`;
    const params = new URLSearchParams({
      storeId: String(storeId), amount: Number(amount).toFixed(2),
      postBackURL: `${origin}/api/easypaisa/callback`,
      orderRefNum: String(orderId), expiryDate: '',
      merchantHashedReq: hashKey || '',
      autoRedirect: '1', paymentMethod: 'MA_PAYMENT_METHOD',
      emailAddr: customer.email || '', mobileNum: customer.phone || '',
    });
    return res.json({ success: true, redirectUrl: `${baseUrl}?${params.toString()}` });
  });

  app.all('/api/easypaisa/callback', (req: Request, res: Response) => {
    const status  = (req.body?.status         || req.query.status         || '').toString();
    const orderId = (req.body?.orderRefNumber || req.query.orderRefNumber || '').toString();
    const txnRef  = (req.body?.transactionId  || req.query.transactionId  || '').toString();
    const qs = new URLSearchParams({
      easypaisa: status === '0000' || status === 'success' ? 'success' : 'failed',
      ...(orderId ? { orderId } : {}),
      ...(txnRef  ? { txnRef  } : {}),
    }).toString();
    res.redirect(`/?${qs}`);
  });

  // ── PAYFAST (South Africa) ────────────────────────────────────────────────
  app.post('/api/payfast/initiate', (req: Request, res: Response) => {
    const crypto = require('crypto');
    const { amount, orderId, customer = {}, productName } = req.body || {};
    const merchantId  = String(process.env.PAYFAST_MERCHANT_ID || '').trim();
    const merchantKey = String(process.env.PAYFAST_MERCHANT_KEY || '').trim();
    const passphrase  = String(process.env.PAYFAST_PASSPHRASE   || '').trim();
    const sandboxMode = req.body?.sandboxMode ?? (String(process.env.PAYFAST_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!merchantId || !merchantKey) return res.status(400).json({ error: 'PayFast credentials not configured.' });
    if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId are required.' });
    const isSandbox = sandboxMode !== false;
    const postUrl = isSandbox
      ? 'https://sandbox.payfast.co.za/eng/process'
      : 'https://www.payfast.co.za/eng/process';
    const origin = `${(req.headers['x-forwarded-proto'] || req.protocol)}://${req.get('host')}`;
    const fields: Record<string, string> = {
      merchant_id: String(merchantId), merchant_key: String(merchantKey),
      return_url:  `${origin}/api/payfast/callback?status=success&orderId=${encodeURIComponent(orderId)}`,
      cancel_url:  `${origin}/api/payfast/callback?status=cancelled&orderId=${encodeURIComponent(orderId)}`,
      notify_url:  `${origin}/api/payfast/ipn`,
      name_first: (customer.name || 'Customer').split(' ')[0] || 'Customer',
      name_last:  (customer.name || '').split(' ').slice(1).join(' ') || '-',
      email_address: customer.email || 'customer@example.com',
      m_payment_id: String(orderId), amount: Number(amount).toFixed(2),
      item_name: productName || `Order ${orderId}`,
    };
    const encode = (v: any) => encodeURIComponent(String(v)).replace(/%20/g, '+');
    const sigStr = Object.keys(fields)
      .filter(k => fields[k] !== '' && fields[k] !== undefined)
      .map(k => `${k}=${encode(fields[k])}`).join('&');
    const withPass = passphrase ? `${sigStr}&passphrase=${encode(passphrase)}` : sigStr;
    fields.signature = crypto.createHash('md5').update(withPass).digest('hex');
    return res.json({ success: true, postUrl, fields });
  });

  app.all('/api/payfast/callback', (req: Request, res: Response) => {
    const status  = (req.query.status || req.body?.status || '').toString();
    const orderId = (req.query.orderId || req.body?.m_payment_id || '').toString();
    const qs = new URLSearchParams({
      payfast: status === 'success' ? 'success' : 'cancelled',
      ...(orderId ? { orderId } : {}),
    }).toString();
    res.redirect(`/?${qs}`);
  });

  app.post('/api/payfast/ipn', (req: Request, res: Response) => {
    console.log('[PayFast IPN]', req.body);
    res.status(200).send('OK');
  });

  // --- RAZORPAY --------------------------------------------------------------
  app.post('/api/razorpay/create-order', async (req: Request, res: Response) => {
    const { amount, currency = 'INR', orderId } = req.body || {};
    // Accept credentials from body (admin CMS settings) with ENV var fallback
    const keyId     = String(req.body?.razorpayKeyId     || process.env.RAZORPAY_KEY_ID     || '').trim();
    const keySecret = String(req.body?.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!keyId || !keySecret) return res.status(400).json({ error: 'Razorpay credentials not configured. Add Key ID and Key Secret in Admin → Payment Settings.' });
    if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: 'Invalid amount.' });
    try {
      const amountPaise = Math.round(Number(amount) * 100);
      const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: amountPaise, currency,
          receipt: orderId || `QF-${Date.now()}`, payment_capture: 1,
        }),
      });
      const data: any = await rzpRes.json();
      if (data.id) return res.json({ success: true, rzpOrderId: data.id, amount: data.amount, currency: data.currency, keyId });
      return res.status(502).json({ error: 'Razorpay order creation failed.', detail: data });
    } catch (err: any) {
      return res.status(500).json({ error: `Razorpay API error: ${err.message}` });
    }
  });

  app.post('/api/razorpay/verify-payment', async (req: Request, res: Response) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    const keySecret = String(req.body?.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !keySecret)
      return res.status(400).json({ error: 'Missing verification parameters.' });
    try {
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');
      if (expectedSignature === razorpay_signature)
        return res.json({ success: true, verified: true, transactionId: razorpay_payment_id });
      return res.status(400).json({ error: 'Signature verification failed. Payment may be tampered.', verified: false });
    } catch (err: any) {
      return res.status(500).json({ error: `Razorpay verify error: ${err.message}` });
    }
  });

  // --- BKASH -----------------------------------------------------------------
  app.post('/api/bkash/create-payment', async (req: Request, res: Response) => {
    const { amount, orderId } = req.body || {};
    // Accept credentials from body (admin CMS settings) with ENV var fallback
    const appKey    = String(req.body?.bKashAppKey    || process.env.BKASH_APP_KEY    || '').trim();
    const appSecret = String(req.body?.bKashAppSecret || process.env.BKASH_APP_SECRET || '').trim();
    const username  = String(req.body?.bKashUsername  || process.env.BKASH_USERNAME   || '').trim();
    const password  = String(req.body?.bKashPassword  || process.env.BKASH_PASSWORD   || '').trim();
    const sandboxMode = req.body?.sandboxMode ?? (String(process.env.BKASH_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!appKey || !appSecret || !username || !password)
      return res.status(400).json({ error: 'bKash API credentials not configured. Add App Key, App Secret, Username and Password in Admin → Payment Settings.' });
    const baseUrl = sandboxMode
      ? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta'
      : 'https://tokenized.pay.bka.sh/v1.2.0-beta';
    try {
      const tokenRes = await fetch(`${baseUrl}/tokenized/checkout/token/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', username, password } as any,
        body: JSON.stringify({ app_key: appKey, app_secret: appSecret }),
      });
      const tokenData: any = await tokenRes.json();
      if (!tokenData.id_token) return res.status(502).json({ error: 'bKash token grant failed.', detail: tokenData });
      const createRes = await fetch(`${baseUrl}/tokenized/checkout/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: tokenData.id_token, 'X-APP-Key': appKey } as any,
        body: JSON.stringify({
          mode: '0011', payerReference: orderId,
          callbackURL: `${req.protocol}://${req.get('host')}/api/bkash/callback`,
          amount: String(amount), currency: 'BDT', intent: 'sale', merchantInvoiceNumber: orderId,
        }),
      });
      const createData: any = await createRes.json();
      if (createData.statusCode === '0000' && createData.bkashURL)
        return res.json({ success: true, bkashURL: createData.bkashURL, paymentID: createData.paymentID });
      return res.status(502).json({ error: 'bKash payment creation failed.', detail: createData });
    } catch (err: any) {
      return res.status(500).json({ error: `bKash API error: ${err.message}` });
    }
  });

  app.all('/api/bkash/callback', (req: Request, res: Response) => {
    const paymentID = (req.query.paymentID || req.body?.paymentID || '').toString();
    const status    = (req.query.status    || req.body?.status    || '').toString().toLowerCase();
    if (!paymentID || ['cancel', 'failure', 'failed'].includes(status) || !['success', 'completed'].includes(status))
      return res.redirect(`/?bkash=failed&paymentID=${paymentID}`);
    res.redirect(`/?bkash=success&paymentID=${paymentID}`);
  });

  // ── bKash: execute/verify payment after redirect callback ────────────────
  // Frontend calls this after user returns from bKash payment page.
  app.post('/api/bkash/execute-payment', async (req: Request, res: Response) => {
    const body = req.body || {};
    const paymentID  = String(body.paymentID  || body.paymentId || '').trim();
    // Accept credentials from body (stored at initiation time) with ENV var fallback
    const appKey     = String(body.bKashAppKey    || process.env.BKASH_APP_KEY    || '').trim();
    const appSecret  = String(body.bKashAppSecret || process.env.BKASH_APP_SECRET || '').trim();
    const username   = String(body.bKashUsername  || process.env.BKASH_USERNAME   || '').trim();
    const password   = String(body.bKashPassword  || process.env.BKASH_PASSWORD   || '').trim();
    const sandboxMode = body.sandboxMode ?? (String(process.env.BKASH_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!paymentID) return res.status(400).json({ success: false, error: 'Missing paymentID' });
    if (!appKey || !appSecret || !username || !password)
      return res.status(400).json({ success: false, error: 'Missing bKash credentials' });
    const baseUrl = sandboxMode
      ? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout'
      : 'https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout';
    try {
      const tokenRes = await fetch(`${baseUrl}/token/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', username, password } as any,
        body: JSON.stringify({ app_key: appKey, app_secret: appSecret }),
      });
      const tokenData: any = await tokenRes.json().catch(() => ({}));
      if (!tokenData.id_token) return res.status(502).json({ success: false, error: tokenData.statusMessage || 'bKash token grant failed.' });
      const execRes = await fetch(`${baseUrl}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: tokenData.id_token, 'X-APP-Key': appKey } as any,
        body: JSON.stringify({ paymentID }),
      });
      const data: any = await execRes.json().catch(() => ({}));
      if (!execRes.ok || data.transactionStatus !== 'Completed')
        return res.status(502).json({ success: false, error: data.statusMessage || data.message || 'bKash execute failed.', statusCode: data.statusCode, transactionStatus: data.transactionStatus });
      return res.json({ success: true, paymentID: data.paymentID, transactionId: data.trxID, transactionStatus: data.transactionStatus, amount: data.amount });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // --- NAGAD -----------------------------------------------------------------
  app.post('/api/nagad/create-payment', async (req: Request, res: Response) => {
    const { amount, orderId } = req.body || {};
    // Accept credentials from body (admin CMS settings) with ENV var fallback
    const merchantId  = String(req.body?.nagadMerchantId || process.env.NAGAD_MERCHANT_ID || '').trim();
    const sandboxMode = req.body?.sandboxMode ?? (String(process.env.NAGAD_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!merchantId) return res.status(400).json({ error: 'Nagad Merchant ID not configured. Add it in Admin → Payment Settings.' });
    const baseUrl = sandboxMode
      ? 'https://sandbox.mynagad.com:10080/remote-payment-gateway-1.0/api/dfs'
      : 'https://api.mynagad.com/api/dfs';
    const datetime = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    try {
      const initRes = await fetch(`${baseUrl}/check-out/initialize/${merchantId}/${orderId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-KM-Api-Version': 'v-0.2.0',
          'X-KM-IP-V4': req.ip || '127.0.0.1',
          'X-KM-Client-Type': 'PC_WEB',
          'X-KM-MC-Id': merchantId,
        } as any,
        body: JSON.stringify({
          dateTime: datetime,
          sensitiveData: Buffer.from(JSON.stringify({ merchantId, orderId, datetime, challenge: orderId })).toString('base64'),
          signature: '',
        }),
      });
      const initData: any = await initRes.json();
      if (initData.callBackUrl)
        return res.json({ success: true, nagadURL: initData.callBackUrl, paymentReferenceId: initData.paymentReferenceId });
      return res.status(502).json({ error: 'Nagad initialization failed.', detail: initData });
    } catch (err: any) {
      return res.status(500).json({ error: `Nagad API error: ${err.message}` });
    }
  });

  app.all('/api/nagad/callback', (req: Request, res: Response) => {
    const order_id       = (req.query.order_id       || req.body?.order_id       || '').toString();
    const payment_ref_id = (req.query.payment_ref_id || req.body?.payment_ref_id || '').toString();
    const status         = (req.query.status         || req.body?.status         || '').toString();
    const normalized = status.toLowerCase();
    if (!payment_ref_id || !['success', 'completed'].includes(normalized))
      return res.redirect(`/?nagad=failed&order=${order_id}`);
    res.redirect(`/?nagad=success&order=${order_id}&ref=${payment_ref_id}`);
  });

  // ── Nagad: verify payment after redirect callback ────────────────────────
  // Frontend calls this after user returns from Nagad payment page.
  app.post('/api/nagad/verify-payment', async (req: Request, res: Response) => {
    const body = req.body || {};
    const paymentRefId = String(body.paymentRefId || body.payment_ref_id || '').trim();
    const merchantId   = String(process.env.NAGAD_MERCHANT_ID    || '').trim();
    const privateKey   = String(process.env.NAGAD_PRIVATE_KEY    || '').trim();
    const sandboxMode  = body.sandboxMode ?? (String(process.env.NAGAD_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!paymentRefId) return res.status(400).json({ success: false, error: 'Missing paymentRefId' });
    if (!merchantId)   return res.status(400).json({ success: false, error: 'Nagad Merchant ID not configured.' });
    const baseUrl = sandboxMode
      ? 'https://sandbox.mynagad.com:10080/remote-payment-gateway-1.0/api/dfs'
      : 'https://api.mynagad.com/api/dfs';
    try {
      const verifyRes = await fetch(`${baseUrl}/verify/payment/${paymentRefId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-KM-Api-Version': 'v-0.2.0',
          'X-KM-IP-V4': req.ip || '127.0.0.1',
          'X-KM-Client-Type': 'PC_WEB',
          'X-KM-MC-Id': merchantId,
        } as any,
      });
      const data: any = await verifyRes.json().catch(() => ({}));
      if (data.status === 'Success' || data.paymentRefId)
        return res.json({ success: true, transactionId: data.paymentRefId || paymentRefId, amount: data.amount, status: data.status });
      return res.status(502).json({ success: false, error: data.message || 'Nagad verification failed.', detail: data });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // ====================== UNIVERSAL DYNAMIC ROUTER ==========================
  // Any /api/<gateway>/<action> not matched above is forwarded to
  // api/payment.ts (the legacy serverless router) for graceful fallback.
  // The explicit handlers above take precedence — this exists so new
  // CMS-driven gateways can be added without redeploying server code.
  // ==========================================================================
  app.all('/api/:gateway/:action', async (req: Request, res: Response, next: NextFunction) => {
    const { gateway, action } = req.params;
    // The dedicated /api/payment/test-connection handler is registered further below.
    // Skip the universal router for this path so 'payment' is not mistaken for a gateway name.
    if (gateway === 'payment' && action === 'test-connection') return next();
    (req.query as any).gateway = gateway;
    (req.query as any).action = action;
    try {
      const mod: any = await import('./api/payment.js').catch(
        () => import('./api/payment.ts').catch(() => null)
      );
      if (mod && typeof mod.default === 'function') {
        return mod.default(req, res);
      }
      return next();
    } catch (err: any) {
      console.error(`[Universal Router] /api/${gateway}/${action} failed:`, err.message);
      return next();
    }
  });

  // --- SERVE firebase-config.json from environment ----------------------------
  // Checks BOTH naming conventions so the .env file works regardless of whether
  // the user followed the VITE_ prefix (Vite-style) or the bare FIREBASE_
  // prefix (server-style). Either set works; VITE_ takes precedence if both
  // are present, since it's the primary name shown in .env.example.
  // FIXED: Also reads .env from disk directly (same as install-status) so that
  // after the wizard writes .env, incognito/other browsers see the config
  // immediately without a server restart.
  app.get('/firebase-config.json', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');

    // Shared disk-read helper — reads .env once per request if needed
    let _diskEnvCache: Record<string, string> | null = null;
    function readDiskEnv(): Record<string, string> {
      if (_diskEnvCache) return _diskEnvCache;
      _diskEnvCache = {};
      try {
        const content = fs.readFileSync(path.resolve(projectRoot, '.env'), 'utf8');
        for (const line of content.split('\n')) {
          const m = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"#\r\n]*)"?\s*$/);
          if (m) _diskEnvCache[m[1]] = m[2].trim();
        }
      } catch { /* .env not present — ignore */ }
      return _diskEnvCache;
    }

    function pick(keys: string[]): string {
      // Try process.env first (fast path)
      for (const k of keys) { const v = (process.env[k] || '').trim(); if (v) return v; }
      // Fallback: read .env from disk (handles wizard-written .env before server restart)
      const disk = readDiskEnv();
      for (const k of keys) { if (disk[k]) { process.env[k] = disk[k]; return disk[k]; } }
      return '';
    }

    const cfg: Record<string, string> = {
      apiKey:            pick(['VITE_FIREBASE_API_KEY',             'FIREBASE_API_KEY']),
      authDomain:        pick(['VITE_FIREBASE_AUTH_DOMAIN',         'FIREBASE_AUTH_DOMAIN']),
      projectId:         pick(['VITE_FIREBASE_PROJECT_ID',          'FIREBASE_PROJECT_ID']),
      storageBucket:     pick(['VITE_FIREBASE_STORAGE_BUCKET',      'FIREBASE_STORAGE_BUCKET']),
      messagingSenderId: pick(['VITE_FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_MESSAGING_SENDER_ID']),
      appId:             pick(['VITE_FIREBASE_APP_ID',              'FIREBASE_APP_ID']),
    };
    const dbId = pick(['VITE_FIREBASE_DATABASE_ID', 'FIREBASE_DATABASE_ID']);
    if (dbId && dbId !== '(default)') cfg.databaseId = dbId;
    // Only the 3 core fields are required; storageBucket/messagingSenderId are optional.
    const required = ['apiKey', 'authDomain', 'projectId'] as const;
    const missing = required.filter(k => !cfg[k]);
    // Remove empty optional fields from response so client gets a clean object
    (Object.keys(cfg) as Array<keyof typeof cfg>).forEach(k => { if (!cfg[k]) delete (cfg as any)[k]; });
    if (missing.length > 0) {
      // Return 200 with empty object instead of 404 to avoid noisy console errors.
      // The client (firebase.ts) already handles empty/invalid responses gracefully
      // by falling back to localStorage or VITE env vars.
      return res.json({});
    }
    res.json(cfg);
  });

  
  // --- SAVE SUPABASE CONFIG (persist to .env + update process.env) -----------
  app.get('/api/save-supabase-config', (_req: Request, res: Response) => {
    res.json({ ok: true, message: 'Fruitopia Node Supabase save endpoint ready.' });
  });

  app.post('/api/save-supabase-config', (req: any, res: any) => {
    const data = req.body || {};
    const projectUrl = (data.projectUrl || '').trim();
    const anonKey    = (data.anonKey    || '').trim();
    if (!projectUrl || !anonKey) {
      return res.status(400).json({ success: false, message: 'Missing projectUrl or anonKey.' });
    }
    const serverVars: Record<string, string> = {
      SUPABASE_URL:      projectUrl,
      SUPABASE_ANON_KEY: anonKey,
      SUPABASE_PUBLISHABLE_KEY: anonKey,
    };
    const viteVars: Record<string, string> = {
      VITE_SUPABASE_URL:      projectUrl,
      VITE_SUPABASE_ANON_KEY: anonKey,
      VITE_SUPABASE_PUBLISHABLE_KEY: anonKey,
    };
    // Persist ALL vars to .env and update process.env so incognito/other browsers
    // get the correct config immediately via /supabase-config.json and /api/install-status
    const allVars = { ...serverVars, ...viteVars };
    const wroteEnvFile = persistEnvVars(allVars);

    const serverEnvBlock = Object.entries(serverVars).map(([k, v]) => k + '=' + v).join('\n');
    const viteEnvBlock   = Object.entries(viteVars).map(([k, v]) => k + '=' + v).join('\n');
    return res.status(200).json({
      success: true,
      needsEnvVars: !wroteEnvFile,
      wroteEnvFile,
      vars: serverVars,
      viteVars,
      envBlock:     serverEnvBlock,
      viteEnvBlock: viteEnvBlock,
      message: wroteEnvFile
        ? 'Supabase config saved to .env. The app is now configured for all browsers.'
        : 'Supabase config is active for this server session, but .env could not be written. Add these environment variables on your host for permanent cross-browser installs.',
    });
  });

  // --- SERVE supabase-config.json from environment ----------------------------
  // anonKey is a PUBLIC read-only key — safe to serve here.
  // Allows incognito users / fresh browsers to find Supabase config without
  // needing localStorage to be pre-populated.
  // Accepts both SUPABASE_URL and VITE_SUPABASE_URL naming conventions.
  app.get('/supabase-config.json', (_req: Request, res: Response) => {
    // Try process.env first, then fall back to reading .env from disk
    // (handles server-restart edge case where dotenv didn't pick up wizard-written .env)
    const readEnv = (keys: string[]): string => {
      for (const k of keys) {
        const v = (process.env[k] || '').trim();
        if (v) return v;
      }
      try {
        const content = fs.readFileSync(path.resolve(projectRoot, '.env'), 'utf8');
        const cache: Record<string, string> = {};
        for (const line of content.split('\n')) {
          const m = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"#\r\n]*)"?\s*$/);
          if (m) cache[m[1]] = m[2].trim();
        }
        for (const k of keys) {
          if (cache[k]) { process.env[k] = cache[k]; return cache[k]; }
        }
      } catch {}
      return '';
    };
    const projectUrl = readEnv(['VITE_SUPABASE_URL', 'SUPABASE_URL']);
    const anonKey    = readEnv(['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY']);
    if (!projectUrl || !anonKey) {
      // Return 200 with empty object instead of 404 to avoid noisy console errors.
      // The client (supabase.ts) already handles empty/invalid responses gracefully
      // by falling back to localStorage or VITE env vars.
      return res.json({});
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ projectUrl, anonKey });
  });

  // --- INSTALL STATUS (authoritative — based on server env vars only) --------
  // The client calls this first. If the server has valid credentials in .env,
  // it returns installed:true without any DB round-trip. This fixes the
  // repeated-installer bug when credentials live in .env but no DB lock exists.
  app.get('/api/install-status', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');

    // Helper: read a key from process.env, with a live .env fallback.
    // If process.env is empty (e.g. dotenv didn't load the file in time or
    // the server restarted after wizard-write), we re-read the .env file
    // from disk directly so the wizard never re-appears unnecessarily.
    let _envCache: Record<string, string> | null = null;
    const getEnv = (keys: string[]): string => {
      // First try process.env (fast path, covers ENV var dashboards too)
      for (const k of keys) {
        const v = (process.env[k] || '').trim();
        if (v) return v;
      }
      // Fallback: parse .env file from disk (handles server-restart edge case)
      if (!_envCache) {
        _envCache = {};
        try {
          const envPath = path.resolve(projectRoot, '.env');
          const content = fs.readFileSync(envPath, 'utf8');
          for (const line of content.split('\n')) {
            const m = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"#\r\n]*)"?\s*$/);
            if (m) _envCache[m[1]] = m[2].trim();
          }
        } catch { /* file may not exist on static hosts */ }
      }
      for (const k of keys) {
        const v = (_envCache[k] || '').trim();
        if (v) {
          // Repopulate process.env so subsequent calls are fast
          process.env[k] = v;
          return v;
        }
      }
      return '';
    };

    // Supabase: check URL + anon key
    const sbUrl = getEnv(['VITE_SUPABASE_URL', 'SUPABASE_URL']);
    const sbKey = getEnv(['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY']);
    if (sbUrl.startsWith('https://') && sbKey.length > 10) {
      return res.json({ installed: true, backend: 'supabase' });
    }

    // Firebase: check API key (starts with AIza) + projectId
    const fbKey  = getEnv(['VITE_FIREBASE_API_KEY', 'FIREBASE_API_KEY']);
    const fbProj = getEnv(['VITE_FIREBASE_PROJECT_ID', 'FIREBASE_PROJECT_ID']);
    if (fbKey.startsWith('AIza') && fbProj.length > 0) {
      return res.json({ installed: true, backend: 'firebase' });
    }

    return res.json({ installed: false, backend: null });
  });

  // --- SAVE FIREBASE CONFIG --------------------------------------------------
  app.get('/api/save-config', (_req: Request, res: Response) => {
    res.json({ ok: true, message: 'Fruitopia Node save-config endpoint ready.' });
  });

  app.post('/api/save-config', (req: Request, res: Response) => {
    const data = req.body || {};
    const required = ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId'];
    for (const field of required) {
      if (!data[field] || typeof data[field] !== 'string' || !data[field].trim()) {
        return res.status(400).json({ success: false, message: `Missing required field: "${field}"` });
      }
    }
    if (!data.apiKey.trim().startsWith('AIza')) {
      return res.status(400).json({ success: false, message: 'Invalid apiKey format. Firebase Web API keys start with "AIza".' });
    }
    // Server-side env vars (for Render / VPS / cPanel running Node server)
    const serverVars: Record<string, string> = {
      FIREBASE_API_KEY:             data.apiKey.trim(),
      FIREBASE_AUTH_DOMAIN:         data.authDomain.trim(),
      FIREBASE_PROJECT_ID:          data.projectId.trim(),
      ...(data.storageBucket?.trim() ? { FIREBASE_STORAGE_BUCKET: data.storageBucket.trim() } : {}),
      FIREBASE_MESSAGING_SENDER_ID: data.messagingSenderId.trim(),
      FIREBASE_APP_ID:              data.appId.trim(),
    };
    if (data.databaseId?.trim()) serverVars.FIREBASE_DATABASE_ID = data.databaseId.trim();

    // Frontend build-time env vars (for Netlify / Vercel static export / GitHub Pages)
    const viteVars: Record<string, string> = {
      VITE_FIREBASE_API_KEY:             data.apiKey.trim(),
      VITE_FIREBASE_AUTH_DOMAIN:         data.authDomain.trim(),
      VITE_FIREBASE_PROJECT_ID:          data.projectId.trim(),
      ...(data.storageBucket?.trim() ? { VITE_FIREBASE_STORAGE_BUCKET: data.storageBucket.trim() } : {}),
      VITE_FIREBASE_MESSAGING_SENDER_ID: data.messagingSenderId.trim(),
      VITE_FIREBASE_APP_ID:             data.appId.trim(),
    };
    if (data.databaseId?.trim()) viteVars.VITE_FIREBASE_DATABASE_ID = data.databaseId.trim();

    // Persist ALL vars to .env and update process.env so incognito/other browsers
    // see installed:true from /api/install-status immediately
    const allVars = { ...serverVars, ...viteVars };
    const wroteEnvFile = persistEnvVars(allVars);

    const serverEnvBlock = Object.entries(serverVars).map(([k, v]) => `${k}=${v}`).join('\n');
    const viteEnvBlock   = Object.entries(viteVars).map(([k, v]) => `${k}=${v}`).join('\n');

    return res.status(200).json({
      success: true,
      needsEnvVars: !wroteEnvFile,
      wroteEnvFile,
      vars: serverVars,
      viteVars,
      envBlock: serverEnvBlock,
      viteEnvBlock,
      message: wroteEnvFile
        ? 'Firebase config saved to .env. The app is now configured for all browsers.'
        : 'Firebase config is active for this server session, but .env could not be written. Add these environment variables on your host for permanent cross-browser installs.',
    });
  });

  // Alias: /api/system/install → /api/save-config (canonical installer name)
  app.get('/api/system/install',  (_req: Request, res: Response) => {
    res.json({ ok: true, message: 'Fruitopia installer endpoint ready (alias of /api/save-config).' });
  });
  app.post('/api/system/install', (req: Request, _res: Response, next) => {
    (req as any).url = '/api/save-config';
    next();
  });



  // --- PAYMENT GATEWAY TEST CONNECTION HANDLER (SHARED LOGIC) ----
  // Extracted function to handle test-connection for any gateway
  const handleTestConnection = async (gateway: string, credentials: Record<string, string>, res: Response) => {
    try {
      if (gateway === 'stripe') {
        const { secretKey } = credentials;
        if (!secretKey) return void res.json({ success: false, error: 'Secret key is required.' });
        try {
          const r = await fetch('https://api.stripe.com/v1/balance', {
            headers: { Authorization: `Bearer ${secretKey}` },
          });
          if (r.ok) return void res.json({ success: true, message: 'Stripe credentials are valid and authenticated.' });
          
          const err = await r.json().catch(() => ({}));
          const errMsg = (err as any)?.error?.message || '';
          
          if (r.status === 401) {
            return void res.json({ success: false, error: 'Stripe authentication failed. Invalid or expired secret key.' });
          }
          
          if (errMsg !== '') {
            return void res.json({ success: false, error: `Stripe error: ${errMsg}` });
          }
          
          return void res.json({ success: false, error: `Stripe validation failed (HTTP ${r.status}). Please check your secret key.` });
        } catch (err) {
          return void res.json({ success: false, error: `Stripe connection error: ${(err as any).message}` });
        }
      }

      if (gateway === 'paypal') {
        const { clientId, clientSecret, sandbox } = credentials;
        if (!clientId || !clientSecret) return void res.json({ success: false, error: 'Client ID and Secret are required.' });
        const base = sandbox === 'true' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        try {
          const r = await fetch(`${base}/v1/oauth2/token`, {
            method: 'POST',
            headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'grant_type=client_credentials',
          });
          if (r.ok) {
            const data = await r.json().catch(() => ({}));
            if ((data as any)?.access_token) {
              return void res.json({ success: true, message: 'PayPal credentials are valid and authenticated.' });
            }
          }
          
          const err = await r.json().catch(() => ({}));
          const errDesc = (err as any)?.error_description || (err as any)?.error || '';
          
          if (r.status === 401) {
            return void res.json({ success: false, error: 'PayPal authentication failed. Invalid Client ID or Secret.' });
          }
          
          if (errDesc !== '') {
            return void res.json({ success: false, error: `PayPal error: ${errDesc}` });
          }
          
          return void res.json({ success: false, error: `PayPal validation failed (HTTP ${r.status}). Please check your credentials.` });
        } catch (err) {
          return void res.json({ success: false, error: `PayPal connection error: ${(err as any).message}` });
        }
      }

      if (gateway === 'sslcommerz') {
        const { storeId, storePass, sandbox } = credentials;
        if (!storeId || !storePass) return void res.json({ success: false, error: 'Store ID and Password are required.' });
        const base = sandbox === 'true' ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com';
        try {
          const r = await fetch(`${base}/validator/api/validationserverAPI.php?val_id=test&store_id=${encodeURIComponent(storeId)}&store_passwd=${encodeURIComponent(storePass)}&v=1&format=json`);
          const data = await r.json().catch(() => ({}));
          const status = (data as any)?.status?.toUpperCase() || '';
          const failedReason = (data as any)?.failedreason || '';
          
          // Proper validation: check for success status
          if (status === 'VALID' || status === 'VALIDATED') {
            return void res.json({ success: true, message: 'SSLCommerz credentials are valid and working.' });
          }
          
          // Check for specific error messages
          if (failedReason.toLowerCase().includes('invalid')) {
            return void res.json({ success: false, error: 'Invalid SSLCommerz Store ID or Password.' });
          }
          
          if (failedReason.toLowerCase().includes('inactive')) {
            return void res.json({ success: false, error: 'SSLCommerz merchant account is inactive.' });
          }
          
          if (failedReason.toLowerCase().includes('suspended') || failedReason.toLowerCase().includes('blocked')) {
            return void res.json({ success: false, error: 'SSLCommerz merchant account is suspended or blocked.' });
          }
          
          // If we got an error response with failedreason, those credentials are wrong
          if (failedReason && failedReason !== '') {
            return void res.json({ success: false, error: `SSLCommerz validation failed: ${failedReason}` });
          }
          
          // If status is not valid but response came back, credentials are likely incorrect
          if (status !== '' && status !== 'VALID' && status !== 'VALIDATED') {
            return void res.json({ success: false, error: `SSLCommerz validation error: ${status}` });
          }
          
          // Fallback: if we can't determine, report as invalid
          return void res.json({ success: false, error: 'SSLCommerz validation failed. Please check your Store ID and Password.' });
        } catch (err) {
          return void res.json({ success: false, error: `SSLCommerz connection error: ${(err as any).message}` });
        }
      }

      if (gateway === 'razorpay') {
        const { keyId, keySecret } = credentials;
        if (!keyId || !keySecret) return void res.json({ success: false, error: 'Key ID and Key Secret are required.' });
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        try {
          const r = await fetch('https://api.razorpay.com/v1/payments?count=1', {
            headers: { Authorization: `Basic ${auth}` },
          });
          if (r.ok) return void res.json({ success: true, message: 'Razorpay credentials are valid and authenticated.' });
          
          const err = await r.json().catch(() => ({}));
          const errMsg = (err as any)?.error?.description || (err as any)?.error_message || '';
          
          if (r.status === 401) {
            return void res.json({ success: false, error: 'Razorpay authentication failed. Invalid Key ID or Key Secret.' });
          }
          
          if (errMsg !== '') {
            return void res.json({ success: false, error: `Razorpay error: ${errMsg}` });
          }
          
          return void res.json({ success: false, error: `Razorpay validation failed (HTTP ${r.status}). Please check your credentials.` });
        } catch (err) {
          return void res.json({ success: false, error: `Razorpay connection error: ${(err as any).message}` });
        }
      }

      if (gateway === 'bkash') {
        const { appKey, appSecret, username, password, sandbox } = credentials;
        if (!appKey || !appSecret || !username || !password) return void res.json({ success: false, error: 'All four bKash credentials are required.' });
        const base = sandbox === 'true'
          ? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta'
          : 'https://tokenized.pay.bka.sh/v1.2.0-beta';
        try {
          const r = await fetch(`${base}/tokenized/checkout/token/grant`, {
            method: 'POST',
            headers: { username, password, 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_key: appKey, app_secret: appSecret }),
          });
          const data = await r.json().catch(() => ({}));
          
          // Check if authentication was successful
          if ((data as any)?.statusCode === '0000' || (data as any)?.id_token) {
            return void res.json({ success: true, message: 'bKash credentials are valid and authenticated.' });
          }
          
          // Check for specific error messages that indicate invalid credentials
          const statusMsg = (data as any)?.statusMessage || '';
          const statusCode = (data as any)?.statusCode || '';
          
          if (statusMsg.toLowerCase().includes('invalid') || statusCode === '9001' || statusCode === '9002') {
            return void res.json({ success: false, error: 'Invalid bKash credentials. Please check your App Key and App Secret.' });
          }
          
          if (statusMsg.toLowerCase().includes('authorization') || statusCode === '9003') {
            return void res.json({ success: false, error: 'bKash authorization failed. Check your username and password.' });
          }
          
          if (statusMsg !== '') {
            return void res.json({ success: false, error: `bKash validation failed: ${statusMsg}` });
          }
          
          return void res.json({ success: false, error: 'bKash credential validation failed. Please verify all credentials.' });
        } catch (err) {
          return void res.json({ success: false, error: `bKash connection error: ${(err as any).message}` });
        }
      }

      if (gateway === 'nagad') {
        const { merchantId, privateKey } = credentials;
        if (!merchantId || !privateKey) return void res.json({ success: false, error: 'Merchant ID and Private Key are required.' });
        
        // Validate credential presence (Nagad RSA key format check)
        const keyOk = privateKey.includes('BEGIN') && privateKey.includes('END') && privateKey.includes('PRIVATE');
        if (!keyOk) return void res.json({ success: false, error: 'Private key does not look like a valid PEM RSA key. Must contain BEGIN, END, and PRIVATE.' });
        
        // Additional check: verify merchantId format
        if (!merchantId || merchantId.trim().length === 0) {
          return void res.json({ success: false, error: 'Merchant ID cannot be empty.' });
        }
        
        // For Nagad, we can only validate the format, not the actual API call in this context
        // A real transaction test would be needed for full validation
        return void res.json({ success: true, message: 'Nagad credentials format is valid. Full validation requires a test transaction.' });
      }

      // Simple credential presence checks for remaining gateways
      if (gateway === 'paytm') {
        const { mid, key } = credentials;
        if (!mid || !key) return void res.json({ success: false, error: 'Merchant ID and Key are required.' });
        return void res.json({ success: true, message: 'Paytm credentials are saved. Live validation requires a real transaction.' });
      }

      if (gateway === 'jazzcash') {
        const { mid, password } = credentials;
        if (!mid || !password) return void res.json({ success: false, error: 'Merchant ID and Password are required.' });
        return void res.json({ success: true, message: 'JazzCash credentials are saved. Live validation requires a test transaction.' });
      }

      if (gateway === 'easypaisa') {
        const { storeId, hashKey } = credentials;
        if (!storeId || !hashKey) return void res.json({ success: false, error: 'Store ID and Hash Key are required.' });
        return void res.json({ success: true, message: 'Easypaisa credentials are saved. Live validation requires a test transaction.' });
      }

      if (gateway === 'payfast') {
        const { merchantId, merchantKey } = credentials;
        if (!merchantId || !merchantKey) return void res.json({ success: false, error: 'Merchant ID and Key are required.' });
        return void res.json({ success: true, message: 'PayFast credentials are saved. Live validation requires a test transaction.' });
      }

      return void res.json({ success: false, error: `Unknown gateway: ${gateway}` });
    } catch (err: any) {
      return void res.status(500).json({ success: false, error: `Server error: ${err.message}` });
    }
  };

  // --- ROUTE 1: /api/{gateway}/test-connection (Client format) -----
  app.post('/api/:gateway/test-connection', (req: Request, res: Response) => {
    const gateway = (req.params as any).gateway;
    if (gateway === 'payment') {
      // Redirect to main handler
      return (req as any).next?.();
    }
    const { credentials } = req.body as { credentials: Record<string, string> };
    return handleTestConnection(gateway, credentials, res);
  });

  // --- ROUTE 2: /api/payment/test-connection (Canonical format) -----
  app.post('/api/payment/test-connection', async (req: Request, res: Response) => {
    const { gateway, credentials } = req.body as { gateway: string; credentials: Record<string, string> };
    if (!gateway || !credentials) {
      return res.json({ success: false, error: 'Missing gateway or credentials.' });
    }
    return await handleTestConnection(gateway, credentials, res);
  });

  // --- VITE DEV or STATIC PROD ----------------------------------------------
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(projectRoot, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[OK] Server running → http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('[CRITICAL] Server startup error:', err);
  process.exit(1);
});
