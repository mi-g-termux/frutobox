/**
 * Vercel Serverless Function: POST /api/bkash/create-payment
 * Starts a real bKash Tokenized Checkout payment and returns the redirect URL.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGatewayCreds } from '../lib_payments/getGatewayCreds';

type BkashConfig = {
  appKey: string;
  appSecret: string;
  username: string;
  password: string;
  sandboxMode?: boolean;
};

const sanitize = (value: unknown, max = 300) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max) : '';

const baseUrl = (sandboxMode?: boolean) =>
  sandboxMode === false
    ? 'https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout'
    : 'https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout';

function json(res: VercelResponse, status: number, body: Record<string, unknown>) {
  return res.status(status).json(body);
}

async function getGrantToken(config: BkashConfig) {
  const response = await fetch(`${baseUrl(config.sandboxMode)}/token/grant`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      username: config.username,
      password: config.password,
    },
    body: JSON.stringify({ app_key: config.appKey, app_secret: config.appSecret }),
  });

  const data: any = await response.json().catch(() => ({}));
  if (!response.ok || !data.id_token) {
    throw new Error(data.statusMessage || data.message || `bKash token request failed (${response.status})`);
  }
  return data.id_token as string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return json(res, 405, { success: false, error: 'Method not allowed' });
  }

  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const amount = Number(body.amount);
    const orderId = sanitize(body.orderId, 80) || `QF-${Date.now()}`;
    const callbackURL = sanitize(body.callbackURL, 500);
    const creds = await getGatewayCreds('bkash');
    const config: BkashConfig = {
      appKey: creds.appKey,
      appSecret: creds.appSecret,
      username: creds.username,
      password: creds.password,
      sandboxMode: body.sandboxMode !== false,
    };

    if (!Number.isFinite(amount) || amount <= 0) {
      return json(res, 400, { success: false, error: 'Invalid payment amount' });
    }
    if (!callbackURL || !/^https?:\/\//i.test(callbackURL)) {
      return json(res, 400, { success: false, error: 'A valid callbackURL is required' });
    }
    if (!config.appKey || !config.appSecret || !config.username || !config.password) {
      return json(res, 400, { success: false, error: 'Missing bKash credentials' });
    }

    const token = await getGrantToken(config);
    const createResponse = await fetch(`${baseUrl(config.sandboxMode)}/create`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: token,
        'X-APP-Key': config.appKey,
      },
      body: JSON.stringify({
        mode: '0011',
        payerReference: orderId,
        callbackURL,
        amount: amount.toFixed(2),
        currency: 'BDT',
        intent: 'sale',
        merchantInvoiceNumber: orderId,
      }),
    });

    const data: any = await createResponse.json().catch(() => ({}));
    if (!createResponse.ok || !data.bkashURL) {
      return json(res, 502, {
        success: false,
        error: data.statusMessage || data.message || `bKash create payment failed (${createResponse.status})`,
        statusCode: data.statusCode,
      });
    }

    return json(res, 200, {
      success: true,
      bkashURL: data.bkashURL,
      paymentID: data.paymentID,
    });
  } catch (error: any) {
    return json(res, 500, { success: false, error: error?.message || 'bKash payment failed' });
  }
}
