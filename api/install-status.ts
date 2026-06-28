import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  const sbUrl = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const sbKey = String(
    process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      '',
  ).trim();
  if (sbUrl.startsWith('https://') && sbKey.length > 10) {
    return res.status(200).json({ installed: true, backend: 'supabase' });
  }

  const fbKey = String(process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '').trim();
  const fbProject = String(process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '').trim();
  if (fbKey.startsWith('AIza') && fbProject) {
    return res.status(200).json({ installed: true, backend: 'firebase' });
  }

  return res.status(200).json({ installed: false, backend: null });
}