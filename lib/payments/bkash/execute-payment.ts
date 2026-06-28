/**
 * Vercel Serverless Function: POST /api/bkash/execute-payment
 * Verifies/executes a bKash Tokenized Checkout payment after redirect callback.
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
    const paymentID = sanitize(body.paymentID || body.paymentId, 120);
    const creds = await getGatewayCreds('bkash');
    const config: BkashConfig = {
      appKey: creds.appKey,
      appSecret: creds.appSecret,
      username: creds.username,
      password: creds.password,
      sandboxMode: body.sandboxMode !== false,
    };

    if (!paymentID) return json(res, 400, { success: false, error: 'Missing paymentID' });
    if (!config.appKey || !config.appSecret || !config.username || !config.password) {
      return json(res, 400, { success: false, error: 'Missing bKash credentials' });
    }

    const token = await getGrantToken(config);
    const executeResponse = await fetch(`${baseUrl(config.sandboxMode)}/execute`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: token,
        'X-APP-Key': config.appKey,
      },
      body: JSON.stringify({ paymentID }),
    });

    const data: any = await executeResponse.json().catch(() => ({}));
    if (!executeResponse.ok || data.transactionStatus !== 'Completed') {
      return json(res, 502, {
        success: false,
        error: data.statusMessage || data.message || `bKash execute payment failed (${executeResponse.status})`,
        statusCode: data.statusCode,
        transactionStatus: data.transactionStatus,
      });
    }

    return json(res, 200, {
      success: true,
      paymentID: data.paymentID,
      transactionId: data.trxID,
      transactionStatus: data.transactionStatus,
      amount: data.amount,
    });
  } catch (error: any) {
    return json(res, 500, { success: false, error: error?.message || 'bKash payment verification failed' });
  }
}
