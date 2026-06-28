/**
 * Vercel Serverless Function: /api/send-email
 *
 * Replaces the Express server's /api/send-email route.
 * Vercel auto-deploys files under /api/ as serverless functions.
 *
 * NEW: supports an optional `attachments` array, each item shaped as
 *   { filename: string, content: string (base64), contentType?: string }
 * This is how the order-confirmation flow attaches the PDF invoice.
 *
 * Gmail SMTP setup:
 *   host: smtp.gmail.com
 *   port: 587
 *   email: yourname@gmail.com
 *   password: YOUR_APP_PASSWORD  ← NOT your Gmail login password!
 *             (Google Account → Security → 2-Step Verification → App Passwords)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';

interface InboundAttachment {
  filename?: string;
  content?: string; // base64 (without data: URI prefix)
  contentType?: string;
}

type RL = { count: number; reset: number };
const emailRl: Map<string, RL> = (globalThis as any).__fruEmailRL || new Map();
(globalThis as any).__fruEmailRL = emailRl;

const sanitize = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max) : '';

function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function checkRate(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const cur = emailRl.get(key);
  if (!cur || now > cur.reset) {
    emailRl.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (cur.count >= max) return false;
  cur.count++;
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const raw = req.body || {};
  const to = sanitize(raw.to, 254);
  const subject = sanitize(raw.subject, 200);
  const html = typeof raw.html === 'string' ? raw.html.slice(0, 100_000) : '';
  const { smtpSettings, attachments } = raw;

  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, html' });
  }
  if (!isEmail(to)) {
    return res.status(400).json({ error: 'Invalid recipient email' });
  }
  if (!checkRate(`email:${to}`, 10, 60_000)) {
    return res.status(429).json({ success: false, error: 'Too many email requests. Please wait before retrying.' });
  }

  const smtp = smtpSettings || { isEnabled: false };

  // If SMTP is not configured, just acknowledge (email skipped)
  if (!smtp.isEnabled || !smtp.host || !smtp.email || !smtp.password) {
    console.log(`[EMAIL SKIPPED] SMTP not configured. Would have sent to: ${to} | Subject: ${subject}`);
    return res.status(200).json({
      success: true,
      simulated: true,
      message: 'SMTP not configured — email skipped. Configure SMTP in Admin → Settings → SMTP.',
    });
  }

  try {
    const port = Number(smtp.port || 587);

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port,
      secure: port === 465,
      auth: {
        user: smtp.email,
        pass: smtp.password,
      },
      tls: { rejectUnauthorized: false },
    });

    // Normalize attachments: accept only well-formed entries with base64
    // content. Silently drop malformed entries instead of failing the send.
    const normalizedAttachments = Array.isArray(attachments)
      ? attachments
          .filter((a: InboundAttachment) => a && typeof a.content === 'string' && a.content.length > 0)
          .map((a: InboundAttachment) => ({
            filename: a.filename || 'attachment',
            content: a.content as string,
            encoding: 'base64' as const,
            contentType: a.contentType || 'application/octet-stream',
          }))
      : [];

    const info = await transporter.sendMail({
      from: `"${smtp.fromName || 'Store'}" <${smtp.email}>`,
      to,
      subject,
      html,
      attachments: normalizedAttachments.length ? normalizedAttachments : undefined,
    });

    console.log(
      `[EMAIL SENT] To: ${to} | MessageID: ${info.messageId} | Attachments: ${normalizedAttachments.length}`,
    );
    return res.status(200).json({ success: true, messageId: info.messageId });

  } catch (err: any) {
    console.error('[EMAIL ERROR]', err.message);
    return res.status(500).json({
      success: false,
      error: 'Email delivery failed.',
      hint: 'For Gmail: make sure you used an App Password (not your Gmail password). Enable 2FA first, then generate App Password at myaccount.google.com/apppasswords',
    });
  }
}
