/**
 * Vercel Serverless Function: GET /api/firebase-config
 *
 * Returns the Firebase Web App config as JSON, built from environment
 * variables set in Vercel Project Settings → Environment Variables.
 *
 * vercel.json rewrites /firebase-config.json → /api/firebase-config, so the
 * browser fetch in src/firebase.ts transparently picks this up — no
 * firebase-config.json file needs to live in the repo or be uploaded.
 *
 * Required env vars:
 *   FIREBASE_API_KEY
 *   FIREBASE_AUTH_DOMAIN
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_STORAGE_BUCKET
 *   FIREBASE_MESSAGING_SENDER_ID
 *   FIREBASE_APP_ID
 * Optional:
 *   FIREBASE_DATABASE_ID  (defaults to "(default)")
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const required = {
    apiKey:            process.env.FIREBASE_API_KEY,
    authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
    projectId:         process.env.FIREBASE_PROJECT_ID,
    storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId:             process.env.FIREBASE_APP_ID,
  };

  const missing = Object.entries(required)
    .filter(([, v]) => !v || !String(v).trim())
    .map(([k]) => k);

  if (missing.length) {
    return res.status(404).json({
      error: 'firebase-config not configured',
      missing,
      hint: 'Set the FIREBASE_* environment variables in Vercel Project Settings → Environment Variables, then redeploy.',
    });
  }

  const cfg: Record<string, string> = {
    apiKey:            String(required.apiKey).trim(),
    authDomain:        String(required.authDomain).trim(),
    projectId:         String(required.projectId).trim(),
    storageBucket:     String(required.storageBucket).trim(),
    messagingSenderId: String(required.messagingSenderId).trim(),
    appId:             String(required.appId).trim(),
  };
  if (process.env.FIREBASE_DATABASE_ID && process.env.FIREBASE_DATABASE_ID.trim()) {
    cfg.databaseId = process.env.FIREBASE_DATABASE_ID.trim();
  }

  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json(cfg);
}
