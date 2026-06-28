import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      message: 'Fruitopia Vercel Supabase save endpoint ready.',
      readOnlyFs: true,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const data = (req.body || {}) as Record<string, string>;
  const projectUrl = (data.projectUrl || '').trim();
  const anonKey = (data.anonKey || '').trim();
  if (!projectUrl || !anonKey) {
    return res.status(400).json({ success: false, message: 'Missing projectUrl or anonKey.' });
  }

  const vars: Record<string, string> = {
    SUPABASE_URL: projectUrl,
    SUPABASE_ANON_KEY: anonKey,
    SUPABASE_PUBLISHABLE_KEY: anonKey,
    VITE_SUPABASE_URL: projectUrl,
    VITE_SUPABASE_ANON_KEY: anonKey,
    VITE_SUPABASE_PUBLISHABLE_KEY: anonKey,
  };
  const envBlock = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n');

  return res.status(200).json({
    success: false,
    needsEnvVars: true,
    vars,
    envBlock,
    viteEnvBlock: envBlock,
    message:
      'Vercel filesystem is read-only. Add these Supabase environment variables in Project Settings → Environment Variables, then redeploy. The Install Wizard will not appear again afterwards.',
  });
}