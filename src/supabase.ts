/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Fruitopia — Supabase PostgreSQL Driver
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This module provides a self-contained Supabase client lifecycle manager.
 * It mirrors the interface pattern used in firebase.ts so that AppContext
 * can treat both backends symmetrically.
 *
 * Architecture notes:
 *  - The Supabase JS SDK is loaded dynamically (import()) so it has ZERO
 *    bundle cost when the engine is 'local' or 'firebase'.
 *  - A single SupabaseClient instance is held as a module-level singleton.
 *  - `reinitializeSupabase()` tears down the old client, instantiates a new
 *    one, and fires all registered ready-change callbacks.
 *  - Real-time subscriptions for siteSettings are established here;
 *    AppContext consumes them via `onSupabaseSettingsChange`.
 *
 * Config resolution priority (highest → lowest):
 *  1. /supabase-config.json  — server endpoint backed by SUPABASE_* env vars
 *  2. VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY — baked in at build time
 *                              (Netlify, Vercel static, Render)
 *  3. localStorage['fruitopia_supabase_config'] — same-browser install session
 *
 * localStorage key: `fruitopia_supabase_config`
 * Key shape: { projectUrl: string; anonKey: string }
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Public credential shape ──────────────────────────────────────────────────
export interface SupabaseRuntimeConfig {
  projectUrl: string; // e.g. https://xyzabc.supabase.co
  anonKey: string;    // Supabase anon public key
}

// ── localStorage key ─────────────────────────────────────────────────────────
export const SUPABASE_CONFIG_KEY = 'fruitopia_supabase_config';

// ── Internal client singleton (typed loosely to avoid mandatory SDK types) ───
// We use `any` deliberately here because the Supabase SDK is loaded
// dynamically — importing its TS types statically would force it into the
// initial bundle even when not used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any | null = null;
let _ready = false;

// ── Realtime channel for siteSettings ────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _settingsChannel: any | null = null;

// ── Ready-change callbacks ────────────────────────────────────────────────────
type ReadyCallback = (isReady: boolean) => void;
const _readyListeners = new Set<ReadyCallback>();

/**
 * Subscribe to Supabase ready-state changes.
 * Returns an unsubscribe function — call it to clean up.
 */
export function onSupabaseReadyChange(cb: ReadyCallback): () => void {
  _readyListeners.add(cb);
  return () => _readyListeners.delete(cb);
}

function _notifyReady(val: boolean) {
  _ready = val;
  _readyListeners.forEach((cb) => cb(val));
}

// ── siteSettings change callbacks ────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SettingsCallback = (payload: any) => void;
const _settingsListeners = new Set<SettingsCallback>();

/**
 * Subscribe to live siteSettings row changes from Supabase Realtime.
 * Callback fires with the parsed `value` object whenever the `settings` table
 * row with key='siteSettings' is updated.
 */
export function onSupabaseSettingsChange(cb: SettingsCallback): () => void {
  _settingsListeners.add(cb);
  return () => _settingsListeners.delete(cb);
}

function _notifySettings(payload: unknown) {
  _settingsListeners.forEach((cb) => cb(payload));
}

// ── Generic all-settings change callbacks ─────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AllSettingsCallback = (key: string, value: any) => void;
const _allSettingsListeners = new Set<AllSettingsCallback>();

/**
 * Subscribe to ANY settings row change from Supabase Realtime.
 * Callback fires with the settings key and its parsed value object.
 * Covers all keys: siteSettings, paymentSettings, smtpSettings, adminSettings,
 * supportSettings, smsSettings, emailVerification, etc.
 */
export function onSupabaseAnySettingChange(cb: AllSettingsCallback): () => void {
  _allSettingsListeners.add(cb);
  return () => _allSettingsListeners.delete(cb);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _notifyAllSettings(key: string, value: any) {
  _allSettingsListeners.forEach((cb) => cb(key, value));
}

// ── Read persisted config from localStorage ───────────────────────────────────
export function getSupabaseRuntimeConfig(): SupabaseRuntimeConfig | null {
  try {
    const raw = localStorage.getItem(SUPABASE_CONFIG_KEY);
    if (!raw) return null;
    const parsed: SupabaseRuntimeConfig = JSON.parse(raw);
    if (!parsed.projectUrl || !parsed.anonKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Resolve Supabase config from ALL available sources in priority order:
 *  1. /supabase-config.json  (Node server with SUPABASE_* env vars)
 *  2. VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (static build-time bake-in)
 *  3. localStorage (same-browser install session)
 *
 * This makes the app work correctly after:
 *   - Setting SUPABASE_* server env vars and restarting (Render/VPS)
 *   - Setting VITE_SUPABASE_* and rebuilding (Netlify/Vercel static)
 *   - Fresh install in same browser (localStorage)
 * Incognito users see the site if server serves /supabase-config.json or
 * VITE env vars are baked into the build.
 */
export async function resolveSupabaseConfig(): Promise<SupabaseRuntimeConfig | null> {
  // Priority 1: /supabase-config.json (served by Node server)
  try {
    const res = await fetch('/supabase-config.json?_v=' + Date.now(), {
      cache: 'no-store',
    });
    if (res.ok) {
      const text = await res.text();
      if (!text.trimStart().startsWith('<')) {
        const json = JSON.parse(text);
        if (
          json &&
          typeof json.projectUrl === 'string' &&
          json.projectUrl.startsWith('https://') &&
          typeof json.anonKey === 'string' &&
          json.anonKey.length > 10
        ) {
          // Persist to localStorage so subsequent operations work offline
          try { localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(json)); } catch {}
          return json as SupabaseRuntimeConfig;
        }
      }
    }
  } catch {
    /* try next source */
  }

  // Priority 2: VITE_SUPABASE_URL + public anon/publishable key (static builds)
  const viteUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
  const viteKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (
    typeof viteUrl === 'string' &&
    viteUrl.startsWith('https://') &&
    typeof viteKey === 'string' &&
    viteKey.length > 10
  ) {
    const cfg: SupabaseRuntimeConfig = { projectUrl: viteUrl, anonKey: viteKey };
    // Persist to localStorage so subsequent operations work consistently
    try { localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(cfg)); } catch {}
    return cfg;
  }

  // Priority 3: localStorage (same-browser install session)
  return getSupabaseRuntimeConfig();
}

// ── Tear down any live Realtime channel ──────────────────────────────────────
async function _destroyChannel() {
  if (_settingsChannel && _client) {
    try {
      await _client.removeChannel(_settingsChannel);
    } catch {
      /* ignore */
    }
    _settingsChannel = null;
  }
}

// ── Attach Realtime subscription for ALL settings rows ────────────────────────
function _attachSettingsRealtime() {
  if (!_client) return;
  try {
    _settingsChannel = _client
      .channel('supabase-settings-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'settings',
          // No key filter — subscribe to every settings row so that
          // paymentSettings, smtpSettings, adminSettings, etc. all push
          // live updates to any open tab/browser.
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const row = payload?.new || payload?.old;
          if (!row) return;
          const key = row.key as string;
          // `value` is stored as JSONB — Supabase Realtime returns it already parsed.
          const value = row.value;
          console.log('[Supabase] settings row changed via Realtime:', key);
          // Notify siteSettings-specific listeners (backward-compat)
          if (key === 'siteSettings') {
            _notifySettings(value);
          }
          // Notify generic all-settings listeners (covers every key)
          _notifyAllSettings(key, value);
        },
      )
      .subscribe((status: string) => {
        console.log('[Supabase] Realtime channel status:', status);
      });
  } catch (err) {
    console.warn('[Supabase] Failed to attach Realtime channel:', err);
  }
}

/**
 * Tear down the existing Supabase client and build a fresh one.
 * Called internally by `reinitializeSupabase`.
 */
async function _bootSupabase(config: SupabaseRuntimeConfig): Promise<void> {
  // Destroy any existing realtime channel first
  await _destroyChannel();
  _client = null;
  _ready = false;

  try {
    // Lazy-load the Supabase SDK — zero cost when not used
    const { createClient } = await import('@supabase/supabase-js');
    _client = createClient(config.projectUrl, config.anonKey, {
      auth: { persistSession: false }, // Admin-panel only usage
    });
    _ready = true;
    _attachSettingsRealtime();
    console.log(`[Supabase] ✅ Connected → ${config.projectUrl}`);
    _notifyReady(true);
  } catch (err) {
    console.warn('[Supabase] Boot failed — falling back to local mock mode:', err);
    _client = null;
    _notifyReady(false);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the live Supabase client, or null if not configured.
 * Always use this getter — never cache the reference at call site,
 * because `reinitializeSupabase` may swap the instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSupabaseClient(): any | null {
  return _client;
}

/** Returns true when a live Supabase client is mounted and ready. */
export function getIsSupabaseConfigured(): boolean {
  return _ready;
}

/**
 * Verify credentials, persist them, and hot-swap the live client.
 *
 * Test query: attempts a `.from('settings').select('key').limit(1)` to
 * confirm the project URL and key are valid and the `settings` table exists.
 * If that fails, the function returns `{ success: false }` and keeps the
 * previous engine untouched.
 */
export async function reinitializeSupabase(
  config: SupabaseRuntimeConfig,
): Promise<{ success: boolean; message: string }> {
  if (!config.projectUrl || !config.anonKey) {
    return { success: false, message: 'Project URL and Anon Key are required.' };
  }

  try {
    // ── Connectivity test with a throwaway client ────────────────────────────
    const { createClient } = await import('@supabase/supabase-js');
    const testClient = createClient(config.projectUrl, config.anonKey, {
      auth: { persistSession: false },
    });

    // A lightweight probe: list up to 1 row from `settings`.
    // If the table doesn't exist, Supabase returns a 42P01 error which we
    // treat as a connected-but-missing-table scenario (still a success for
    // credential purposes — admin may need to run migrations).
    const { error } = await testClient
      .from('settings')
      .select('key')
      .limit(1);

    if (error && error.code !== '42P01' /* relation does not exist */) {
      return {
        success: false,
        message: `Connection test failed: ${error.message} (${error.code}). Check your Project URL and Anon Key.`,
      };
    }

    // ── Persist to localStorage ──────────────────────────────────────────────
    localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(config));

    // ── Hot-swap live client ──────────────────────────────────────────────────
    await _bootSupabase(config);

    return {
      success: true,
      message: `Supabase connected to ${config.projectUrl} successfully.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[Supabase] reinitialize failed:', err);
    return {
      success: false,
      message: `Connection failed: ${msg}. Verify the Project URL format (https://xxx.supabase.co) and your Anon Key.`,
    };
  }
}

/**
 * Disconnect Supabase: destroy realtime channel, clear localStorage, reset state.
 */
export async function disconnectSupabase(): Promise<void> {
  await _destroyChannel();
  _client = null;
  localStorage.removeItem(SUPABASE_CONFIG_KEY);
  _notifyReady(false);
  console.log('[Supabase] Disconnected.');
}

// ── Boot from persisted config on module load ─────────────────────────────────
// Resolves from ALL config sources (server JSON, VITE env vars, localStorage)
// so both engines restore themselves across page refreshes and incognito tabs
// when the admin has set the appropriate environment variables.
export const supabaseBootPromise: Promise<void> = (async () => {
  const saved = await resolveSupabaseConfig();
  if (saved) {
    await _bootSupabase(saved);
  }
})();
