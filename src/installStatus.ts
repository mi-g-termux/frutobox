/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Fruitopia — Cross-Backend Install Status
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Priority order for "is this site installed?":
 *
 *  1. /api/install-status  — Node server checks its own env vars (.env).
 *                            Most authoritative. Works in incognito. No DB
 *                            round-trip. If server has valid creds → done.
 *
 *  2. VITE_FIREBASE_* / VITE_SUPABASE_* build-time vars baked into the
 *     frontend bundle (Netlify / Vercel static builds without a Node server).
 *
 *  3. localStorage  + DB install_lock — the original browser-session flow.
 *     Used when the user ran the install wizard and the server has no .env.
 *
 * This three-tier approach means:
 *   • Setting .env and restarting the server → app loads immediately,
 *     no installer, works in incognito, no tab-switch flicker.
 *   • Static host with VITE_* vars baked in → same.
 *   • First-time setup with no .env → wizard appears (correct).
 *   • After wizard completes → lock written to DB; subsequent loads check it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getDb, firebaseBootPromise, getIsFirebaseConfigured } from './firebase';
import { getSupabaseClient, getSupabaseRuntimeConfig, supabaseBootPromise } from './supabase';
import { setActiveEngine } from './db';

export type InstalledBackend = 'firebase' | 'supabase';
export interface InstallCheck {
  installed: boolean;
  backend: InstalledBackend | null;
  /** True when config exists on this side but the DB lock is missing. */
  configWithoutLock: boolean;
}

const LOCK_TIMEOUT_MS = 5_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('install-lock check timed out')), ms),
    ),
  ]);
}

// ── Tier 1: server endpoint ───────────────────────────────────────────────────

/**
 * Ask the Node server whether it has credentials in its .env.
 * Returns null if the server is unreachable (static host, no Node process).
 */
async function askServer(): Promise<{ installed: boolean; backend: InstalledBackend | null } | null> {
  try {
    const res = await fetch('/api/install-status?_v=' + Date.now(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.trimStart().startsWith('<')) return null; // HTML fallback page, no Node
    const json = JSON.parse(text);
    if (typeof json.installed === 'boolean') return json;
    return null;
  } catch {
    return null; // server not running or static host
  }
}

// ── Tier 2: VITE_* build-time env vars ───────────────────────────────────────

function getViteFirebaseConfig(): { apiKey: string; projectId: string } | null {
  const apiKey    = (import.meta as any).env?.VITE_FIREBASE_API_KEY as string | undefined;
  const projectId = (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID as string | undefined;
  if (typeof apiKey === 'string' && apiKey.startsWith('AIza') && typeof projectId === 'string' && projectId.length > 0) {
    return { apiKey, projectId };
  }
  return null;
}

function getViteSupabaseConfig(): { projectUrl: string; anonKey: string } | null {
  const projectUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
  const anonKey    = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (typeof projectUrl === 'string' && projectUrl.startsWith('https://') && typeof anonKey === 'string' && anonKey.length > 10) {
    return { projectUrl, anonKey };
  }
  return null;
}

// ── Tier 3: localStorage + DB lock ───────────────────────────────────────────

async function firebaseLockPresent(): Promise<boolean> {
  try {
    await firebaseBootPromise;
    const { doc, getDoc } = await import('firebase/firestore');
    const db = getDb();
    const snap = await withTimeout(getDoc(doc(db, 'settings', 'install_lock')), LOCK_TIMEOUT_MS);
    const data = snap.exists() ? snap.data() : null;
    return !!(data && data.locked === true);
  } catch {
    return false;
  }
}

async function supabaseLockPresent(cfg?: { projectUrl: string; anonKey: string } | null): Promise<boolean> {
  try {
    let client = getSupabaseClient();
    if (!client) {
      const resolvedCfg = cfg ?? getSupabaseRuntimeConfig();
      if (!resolvedCfg) return false;
      const { createClient } = await import('@supabase/supabase-js');
      client = createClient(resolvedCfg.projectUrl, resolvedCfg.anonKey, { auth: { persistSession: false } });
    }
    const res: any = await withTimeout(
      client.from('settings').select('value').eq('key', 'install_lock').maybeSingle(),
      LOCK_TIMEOUT_MS,
    );
    const { data, error } = res;
    if (error) return false;
    const val = data?.value;
    return !!(val && val.locked === true);
  } catch {
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Three-tier install check. Fast path first (server), static-build second,
 * browser-session last.
 */
export async function checkInstalled(): Promise<InstallCheck> {

  // ── Tier 1: ask the Node server ──────────────────────────────────────────
  // If the server is running and has credentials in .env, trust it immediately.
  // This fixes the repeated-installer bug when .env is set but no DB lock exists.
  const serverStatus = await askServer();
  if (serverStatus?.installed && serverStatus.backend) {
    setActiveEngine(serverStatus.backend);
    return { installed: true, backend: serverStatus.backend, configWithoutLock: false };
  }

  // ── Tier 2: VITE_* build-time vars (static Netlify/Vercel, no Node) ──────
  const viteSupabase = getViteSupabaseConfig();
  if (viteSupabase) {
    setActiveEngine('supabase');
    return { installed: true, backend: 'supabase', configWithoutLock: false };
  }

  const viteFirebase = getViteFirebaseConfig();
  if (viteFirebase) {
    setActiveEngine('firebase');
    return { installed: true, backend: 'firebase', configWithoutLock: false };
  }

  // ── Tier 3: localStorage + DB lock (same-browser install session) ─────────
  // Wait for async backend boots before querying clients.
  await Promise.allSettled([firebaseBootPromise, supabaseBootPromise]);

  // Supabase: localStorage config + DB lock
  const lsSupabase = getSupabaseRuntimeConfig();
  if (lsSupabase) {
    let locked = false;
    try {
      locked = await supabaseLockPresent(lsSupabase);
    } catch {
      // Lock check failed (network, perms, timeout) — trust the config rather
      // than showing the installer again and wiping a real installation.
      locked = true;
    }
    if (locked) {
      setActiveEngine('supabase');
      return { installed: true, backend: 'supabase', configWithoutLock: false };
    }
    // Config present but lock explicitly returned false (not an error) →
    // only treat as uninstalled if no other backend is configured.
    if (!getIsFirebaseConfigured() && !getViteFirebaseConfig()) {
      // Give the user the benefit of the doubt: maybe install_lock row is
      // missing due to a failed wizard step. Trust the config anyway.
      setActiveEngine('supabase');
      return { installed: true, backend: 'supabase', configWithoutLock: true };
    }
  }

  // Firebase: any config source + DB lock
  const hasFirebase = getIsFirebaseConfigured() || !!((() => {
    try {
      const raw = localStorage.getItem('fruitopia_dynamic_firebase');
      if (!raw) return false;
      const cfg = JSON.parse(raw);
      return typeof cfg?.apiKey === 'string' && cfg.apiKey.startsWith('AIza') && typeof cfg?.projectId === 'string';
    } catch { return false; }
  })());

  if (hasFirebase) {
    let locked = false;
    try {
      locked = await firebaseLockPresent();
    } catch {
      locked = true; // trust the config if lock check fails
    }
    if (locked) {
      setActiveEngine('firebase');
      return { installed: true, backend: 'firebase', configWithoutLock: false };
    }
    // Config present but lock missing — trust it rather than re-running installer
    setActiveEngine('firebase');
    return { installed: true, backend: 'firebase', configWithoutLock: true };
  }

  return { installed: false, backend: null, configWithoutLock: false };
}

/**
 * Write the install lock to whichever backend was just configured.
 * Called at the end of the install wizard.
 */
export async function writeInstallLock(backend: InstalledBackend): Promise<void> {
  const lockedAt = new Date().toISOString();
  if (backend === 'firebase') {
    const { doc, setDoc } = await import('firebase/firestore');
    const db = getDb();
    await setDoc(doc(db, 'settings', 'install_lock'), { locked: true, lockedAt });
    return;
  }
  if (backend === 'supabase') {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase client not initialised');
    const { error } = await client
      .from('settings')
      .upsert({ key: 'install_lock', value: { locked: true, lockedAt } }, { onConflict: 'key' });
    if (error) throw new Error(error.message);
    return;
  }
}

/**
 * Clear the install lock so the wizard can be re-run.
 * Called by the AdminPanel "Switch backend" action.
 */
export async function clearInstallLock(backend: InstalledBackend): Promise<void> {
  if (backend === 'firebase') {
    try {
      const { doc, setDoc } = await import('firebase/firestore');
      const db = getDb();
      await setDoc(doc(db, 'settings', 'install_lock'), { locked: false, clearedAt: new Date().toISOString() });
    } catch {
      /* ignore — even if write fails, the local switch flow continues */
    }
    return;
  }
  if (backend === 'supabase') {
    try {
      const client = getSupabaseClient();
      if (client) {
        await client
          .from('settings')
          .upsert({ key: 'install_lock', value: { locked: false, clearedAt: new Date().toISOString() } }, { onConflict: 'key' });
      }
    } catch {
      /* ignore */
    }
    return;
  }
}
