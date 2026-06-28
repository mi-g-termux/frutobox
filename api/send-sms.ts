/**
 * Vercel Serverless Function: POST /api/send-sms
 *
 * Twilio integration that supports TWO delivery channels:
 *   - "sms"      → classic SMS via Twilio Programmable Messaging
 *   - "whatsapp" → Twilio WhatsApp API (sandbox or approved sender)
 *
 * The admin panel decides which channel to use by passing
 *   twilioSettings.channel = 'sms' | 'whatsapp'
 *
 * Body:
 * {
 *   to: "+8801XXXXXXXXX",
 *   message: "...",
 *   twilioSettings: {
 *     isEnabled: boolean,
 *     channel?: 'sms' | 'whatsapp',          // default 'sms'
 *     accountSid: string,
 *     authToken: string,
 *     fromNumber: string,                    // SMS sender (E.164)
 *     whatsappFromNumber?: string            // WhatsApp sender (E.164, no "whatsapp:" prefix)
 *   }
 * }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

type RL = { count: number; reset: number };
const rl: Map<string, RL> = (globalThis as any).__fruSmsRL || new Map();
(globalThis as any).__fruSmsRL = rl;

function checkRate(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const cur = rl.get(key);
  if (!cur || now > cur.reset) {
    rl.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (cur.count >= max) return false;
  cur.count++;
  return true;
}

const sanitize = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max) : '';

/** Loose E.164 check: leading "+", 8–15 digits. */
function isE164(s: string) {
  return /^\+[1-9]\d{7,14}$/.test(s);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const raw = (req.body || {}) as any;
  const to      = sanitize(raw.to, 20);
  const message = sanitize(raw.message, 1000);
  const ts      = raw.twilioSettings || {};
  const channel: 'sms' | 'whatsapp' =
    ts.channel === 'whatsapp' ? 'whatsapp' : 'sms';

  if (!to || !message) {
    return res.status(400).json({ success: false, error: 'Missing fields' });
  }
  if (!isE164(to)) {
    return res.status(400).json({
      success: false,
      error: 'Recipient must be in international E.164 format, e.g. +8801712345678',
    });
  }

  // Choose the correct "From" depending on channel
  const fromSms      = sanitize(ts.fromNumber, 20);
  const fromWhatsApp = sanitize(ts.whatsappFromNumber, 20);
  const fromActive   = channel === 'whatsapp' ? fromWhatsApp : fromSms;

  if (!ts.isEnabled || !ts.accountSid || !ts.authToken || !fromActive) {
    return res.status(200).json({
      success: true, simulated: true, channel,
      message: `${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} gateway not configured.`,
    });
  }

  if (!checkRate(`${channel}:${to}`, 3, 60_000)) {
    return res.status(429).json({
      success: false,
      error: 'Too many requests. Please wait before requesting another OTP.',
    });
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(ts.accountSid)}/Messages.json`;
    const basic = Buffer.from(`${ts.accountSid}:${ts.authToken}`).toString('base64');

    // For WhatsApp, Twilio requires the "whatsapp:" prefix on both To and From.
    const toField   = channel === 'whatsapp' ? `whatsapp:${to}`         : to;
    const fromField = channel === 'whatsapp' ? `whatsapp:${fromActive}` : fromActive;

    const body = new URLSearchParams({ To: toField, From: fromField, Body: message });

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const data: any = await resp.json().catch(() => ({}));
    if (resp.ok && data.sid) {
      return res.status(200).json({ success: true, channel, sid: data.sid });
    }
    return res.status(502).json({
      success: false,
      channel,
      error: data.message || 'Twilio error',
      code: data.code,
      status: resp.status,
    });
  } catch (err: any) {
    console.error('[SMS ERROR]', err?.message || err);
    return res.status(500).json({ success: false, channel, error: 'SMS delivery failed.' });
  }
}
