import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const projectUrl = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const anonKey = String(
    process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      '',
  ).trim();

  if (!projectUrl || !anonKey) {
    return res.status(404).json({
      error: 'supabase-config not configured',
      missing: [!projectUrl && 'SUPABASE_URL', !anonKey && 'SUPABASE_ANON_KEY'].filter(Boolean),
      hint: 'Set the SUPABASE_* or VITE_SUPABASE_* environment variables in your host and redeploy.',
    });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ projectUrl, anonKey });
}