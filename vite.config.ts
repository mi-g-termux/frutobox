import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Load ALL .env vars (passing '' as prefix loads everything, not just VITE_)
  const env = loadEnv(mode, process.cwd(), '');

  // Bridge: expose FIREBASE_* vars as VITE_FIREBASE_* so the frontend can see
  // them via import.meta.env regardless of which naming convention is used in
  // the .env file. VITE_FIREBASE_* takes precedence when both are present.
  // This means users only need ONE set of vars — whichever naming they prefer.
  const FB_FIELDS = [
    'API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID',
    'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID', 'DATABASE_ID',
  ] as const;
  const define: Record<string, string> = {};
  for (const field of FB_FIELDS) {
    const viteKey = `VITE_FIREBASE_${field}`;
    const bareKey = `FIREBASE_${field}`;
    // Only define if a value exists; don't override Vite's own VITE_ handling
    const value = env[viteKey] || env[bareKey] || '';
    if (value) {
      define[`import.meta.env.${viteKey}`] = JSON.stringify(value);
    }
  }
  // Bridge Supabase vars too
  const sbUrl = env['VITE_SUPABASE_URL'] || env['SUPABASE_URL'] || '';
  const sbKey = env['VITE_SUPABASE_ANON_KEY'] || env['SUPABASE_ANON_KEY'] || '';
  if (sbUrl) define['import.meta.env.VITE_SUPABASE_URL'] = JSON.stringify(sbUrl);
  if (sbKey) define['import.meta.env.VITE_SUPABASE_ANON_KEY'] = JSON.stringify(sbKey);

  return {
    plugins: [react(), tailwindcss()],
    define,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            firebase: ['firebase/app', 'firebase/firestore', 'firebase/auth'],
          },
        },
      },
    },
    preview: {
      port: 4173,
    },
  };
});
