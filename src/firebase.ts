/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Firebase runtime orchestration — Universal Boot Priority Chain
 * ══════════════════════════════════════════════════════════════
 *
 * Config is resolved in this priority order (highest → lowest):
 *
 *  1. /firebase-config.json — runtime endpoint backed by environment vars.
 *
 *  2. localStorage['fruitopia_dynamic_firebase']
 *                            — Admin Panel hot-swap / dev fallback.
 *                              Written by saveRuntimeFirebaseConfig().
 *
 *  3. VITE_FIREBASE_* env vars
 *                            — Vercel / Netlify / .env build-time vars.
 *
 *  4. src/firebase-applet-config.json
 *                            — Local development JSON file, last resort.
 *
 * If none of the above has a valid apiKey → app runs in Local Mock mode.
 *
 * ── New exports added in this version ───────────────────────────────────────
 *  getActiveFirebaseSource()     — which priority level is active
 *  saveRuntimeFirebaseConfig()   — write to localStorage + hot-reinit
 *  probeInstallHelper()          — detect server capability (php/node/none)
 *  disconnectFirebase()          — tear down cleanly (engine switching)
 *
 * ── Unchanged existing exports ───────────────────────────────────────────────
 *  db, auth, isFirebaseConfigured, getIsFirebaseConfigured
 *  reinitializeDynamicFirebase, onFirebaseReadyChange
 *  handleFirestoreError, OperationType, FirestoreErrorInfo
 *  DYNAMIC_FIREBASE_KEY, FirebaseRuntimeConfig
 *  clearFirebaseConfig
 */

import { initializeApp, getApps, deleteApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import localConfig from './firebase-applet-config.json';

// NOTE: Firebase Storage is intentionally NOT used. All images (product photos,
// logos, etc.) are stored as base64 data URLs directly inside Firestore
// documents. This keeps the app fully functional on the Firebase Spark (free)
// plan, which does NOT include Cloud Storage without enabling billing.
// Base64 encoding adds ~37% overhead; keep images under ~600 KB to stay
// within Firestore's 1 MiB per-document limit.

// ════════════════════════════════════════════════════════════════════════════
// TYPES & CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

/** localStorage key used by Admin Panel and saveRuntimeFirebaseConfig() */
export const DYNAMIC_FIREBASE_KEY = 'fruitopia_dynamic_firebase';

export interface FirebaseRuntimeConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  databaseId?: string;
}

/** Which config source is currently powering the Firebase connection */
export type FirebaseSource = 'file' | 'localstorage' | 'env' | 'json' | 'none';

// ════════════════════════════════════════════════════════════════════════════
// MODULE-LEVEL MUTABLE SINGLETONS
// ════════════════════════════════════════════════════════════════════════════

let _app:           FirebaseApp       | null = null;
let _db:            Firestore         | null = null;
let _auth:          Auth              | null = null;
let _ready:         boolean                  = false;
let _activeSource:  FirebaseSource           = 'none';

// ════════════════════════════════════════════════════════════════════════════
// PRIORITY 1 — /firebase-config.json (async fetch, done once on module load)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Module-level promise that resolves to the config fetched from
 * /firebase-config.json, or null if the file is missing/invalid.
 * The IIFE runs exactly once — subsequent callers await the same promise.
 */
const FIREBASE_CONFIG_URLS = ['/firebase-config.json'];

const _fileConfigPromise: Promise<FirebaseRuntimeConfig | null> = (async () => {
  for (const url of FIREBASE_CONFIG_URLS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(`${url}?_v=${Date.now()}`, {
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timeout);
      if (!res.ok) continue;

      const text = await res.text();
      if (text.trimStart().startsWith('<')) continue;

      try {
        const json = JSON.parse(text);
        if (isValidFirebaseRuntimeConfig(json)) return json;
      } catch {
        // Invalid JSON at this location — try the next supported public path.
      }
    } catch {
      // Missing file, timeout, or network error — try the next supported path.
    }
  }

  return null;
})();

// ════════════════════════════════════════════════════════════════════════════
// READY CALLBACKS — AppContext subscribes to be notified on reinit
// ════════════════════════════════════════════════════════════════════════════

type ReadyCallback = (isReady: boolean) => void;
const _readyListeners = new Set<ReadyCallback>();

const PLACEHOLDER_VALUES = new Set([
  'your-firebase-api-key',
  'your-project-id',
  'your-project.firebaseapp.com',
  'your-project.appspot.com',
  'your-sender-id',
  'your-app-id',
  'apiKey',
  'projectId',
]);

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlaceholderValue(value: unknown): boolean {
  const v = cleanString(value).toLowerCase();
  return !v || PLACEHOLDER_VALUES.has(v) || v.startsWith('your-') || v.includes('your-project');
}

function isValidFirebaseRuntimeConfig(value: unknown): value is FirebaseRuntimeConfig {
  if (!value || typeof value !== 'object') return false;
  const cfg = value as Partial<FirebaseRuntimeConfig>;
  const apiKey = cleanString(cfg.apiKey);
  const projectId = cleanString(cfg.projectId);
  const authDomain = cleanString(cfg.authDomain);

  if (isPlaceholderValue(apiKey) || isPlaceholderValue(projectId) || isPlaceholderValue(authDomain)) return false;
  if (!apiKey.startsWith('AIza')) return false;
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) return false;
  if (!/^[a-z0-9-]+\.(firebaseapp\.com|web\.app)$/i.test(authDomain)) return false;

  return true;
}

export function onFirebaseReadyChange(cb: ReadyCallback): () => void {
  _readyListeners.add(cb);
  return () => _readyListeners.delete(cb);
}

function _notifyReady(val: boolean): void {
  _ready = val;
  _readyListeners.forEach(cb => cb(val));
}

// ════════════════════════════════════════════════════════════════════════════
// CONFIG RESOLUTION HELPERS
// ════════════════════════════════════════════════════════════════════════════

/** Returns first non-empty string from the provided values */
function pick(...vals: (string | undefined | null)[]): string {
  return vals.find(v => typeof v === 'string' && v.trim() !== '') ?? '';
}

/** Read Priority 2 — localStorage */
function getLocalStorageConfig(): FirebaseRuntimeConfig | null {
  try {
    const raw = localStorage.getItem(DYNAMIC_FIREBASE_KEY);
    if (!raw) return null;
    const parsed: FirebaseRuntimeConfig = JSON.parse(raw);
    if (!isValidFirebaseRuntimeConfig(parsed)) {
      localStorage.removeItem(DYNAMIC_FIREBASE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build a merged config object from an optional override, applying the
 * Priority 2 → 3 → 4 fallback chain (Priority 1 is handled separately
 * because it is async).
 */
function buildConfig(override?: FirebaseRuntimeConfig | null): {
  apiKey: string; authDomain: string; projectId: string;
  storageBucket: string; messagingSenderId: string; appId: string;
  databaseId: string;
} {
  const rt = override === undefined ? getLocalStorageConfig() : override;
  // Priority: explicit runtime config > env vars > local JSON.
  // Passing null intentionally skips localStorage so stale browser data
  // cannot hide the first-run installer.
  return {
    apiKey:            pick(rt?.apiKey,            (import.meta as any).env?.VITE_FIREBASE_API_KEY,             localConfig.apiKey),
    authDomain:        pick(rt?.authDomain,        (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN,         localConfig.authDomain),
    projectId:         pick(rt?.projectId,         (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID,          localConfig.projectId),
    storageBucket:     pick(rt?.storageBucket,     (import.meta as any).env?.VITE_FIREBASE_STORAGE_BUCKET,      localConfig.storageBucket),
    messagingSenderId: pick(rt?.messagingSenderId, (import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID, localConfig.messagingSenderId),
    appId:             pick(rt?.appId,             (import.meta as any).env?.VITE_FIREBASE_APP_ID,              localConfig.appId),
    databaseId:        pick(rt?.databaseId,        (import.meta as any).env?.VITE_FIREBASE_DATABASE_ID,         (localConfig as any).firestoreDatabaseId, '(default)'),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// BOOT — create Firebase instances from a resolved config
// ════════════════════════════════════════════════════════════════════════════

function bootFirebase(
  cfg: ReturnType<typeof buildConfig>,
  source: FirebaseSource,
): void {
  if (!isValidFirebaseRuntimeConfig(cfg)) {
    _db      = null;
    _auth    = null;
    _activeSource = 'none';
    _notifyReady(false);
    return;
  }
  try {
    const existing = getApps();
    if (existing.length > 0 && existing[0].options.projectId === cfg.projectId) {
      _app = existing[0];
    } else {
      if (existing.length > 0) {
        existing.forEach(a => deleteApp(a).catch(() => {}));
      }
      _app = initializeApp({
        apiKey:            cfg.apiKey,
        authDomain:        cfg.authDomain,
        projectId:         cfg.projectId,
        storageBucket:     cfg.storageBucket,
        messagingSenderId: cfg.messagingSenderId,
        appId:             cfg.appId,
      });
    }
    _db           = getFirestore(_app, cfg.databaseId || '(default)');
    _auth         = getAuth(_app);
    _activeSource = source;
    _notifyReady(true);
    console.log(
      `[Firebase] ✅ Connected via source="${source}" ` +
      `project="${cfg.projectId}" db="${cfg.databaseId}"`,
    );
  } catch (err) {
    console.warn('[Firebase] Boot failed — falling back to local mock mode:', err);
    _db           = null;
    _auth         = null;
    _activeSource = 'none';
    _notifyReady(false);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ASYNC BOOT SEQUENCE — runs on module load, respects all 4 priorities
// ════════════════════════════════════════════════════════════════════════════

/**
 * Module-level boot promise.
 * Resolves when the best available config source has been tried.
 * Components that need to know Firebase is ready before rendering
 * can await this promise (App.tsx boot check does this).
 */
export const firebaseBootPromise: Promise<void> = (async () => {
  // ── Skip Firebase entirely when Supabase is the explicitly chosen engine ──
  // Prevents "[Firebase] No credentials found — running in local mock mode"
  // and avoids any Firebase SDK initialization when Supabase is active.
  try {
    const activeEngine = localStorage.getItem('fruitopia_active_engine');
    const supabaseCfg  = localStorage.getItem('fruitopia_supabase_config');
    if (activeEngine === 'supabase' && supabaseCfg) {
      _db           = null;
      _auth         = null;
      _activeSource = 'none';
      return; // Firebase never runs — Supabase owns this install
    }
  } catch { /* localStorage unavailable — continue */ }

  // ── Priority 1: /firebase-config.json ────────────────────────────────────
  const fileConfig = await _fileConfigPromise;
  if (fileConfig && fileConfig.apiKey) {
    bootFirebase(buildConfig(fileConfig), 'file');
    return;
  }

  // ── Priority 2: env vars (VITE_FIREBASE_*) ──────────────────────────────────
  const envConfig: FirebaseRuntimeConfig = {
    apiKey:            pick((import.meta as any).env?.VITE_FIREBASE_API_KEY),
    authDomain:        pick((import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN),
    projectId:         pick((import.meta as any).env?.VITE_FIREBASE_PROJECT_ID),
    storageBucket:     pick((import.meta as any).env?.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: pick((import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID),
    appId:             pick((import.meta as any).env?.VITE_FIREBASE_APP_ID),
    databaseId:        pick((import.meta as any).env?.VITE_FIREBASE_DATABASE_ID, '(default)'),
  };
  if (isValidFirebaseRuntimeConfig(envConfig)) {
    bootFirebase(buildConfig(envConfig), 'env');
    return;
  }

  // ── Priority 3: localStorage (InstallWizard / Admin hot-swap) ───────────────
  const lsConfig = getLocalStorageConfig();
  if (lsConfig && isValidFirebaseRuntimeConfig(lsConfig)) {
    bootFirebase(buildConfig(lsConfig), 'localstorage');
    return;
  }

  // ── Priority 4: firebase-applet-config.json ───────────────────────────────
  if (isValidFirebaseRuntimeConfig(localConfig)) {
    bootFirebase(buildConfig(null), 'json');
    return;
  }

  // ── No config found — local mock mode ────────────────────────────────────
  _db           = null;
  _auth         = null;
  _activeSource = 'none';
  _notifyReady(false);
  // Suppress the notice when Supabase is the active engine — Firebase is
  // intentionally unused and the log would mislead admins.
  try {
    const _ae = localStorage.getItem('fruitopia_active_engine');
    if (_ae !== 'supabase') {
      console.log('[Firebase] No credentials found — running in local mock mode.');
    }
  } catch {
    console.log('[Firebase] No credentials found — running in local mock mode.');
  }
})();

// ════════════════════════════════════════════════════════════════════════════
// NEW EXPORT: getActiveFirebaseSource
// ════════════════════════════════════════════════════════════════════════════

/**
 * Returns which priority source is currently powering the Firebase connection.
 * Awaits the boot promise to ensure the async boot has completed first.
 *
 *  'file'         → /firebase-config.json was fetched successfully
 *  'localstorage' → localStorage['fruitopia_dynamic_firebase'] was used
 *  'env'          → VITE_FIREBASE_* environment variables were used
 *  'json'         → src/firebase-applet-config.json was used
 *  'none'         → no valid config found; running in local mock mode
 */
export async function getActiveFirebaseSource(): Promise<FirebaseSource> {
  await firebaseBootPromise;
  return _activeSource;
}

// ════════════════════════════════════════════════════════════════════════════
// NEW EXPORT: saveRuntimeFirebaseConfig
// ════════════════════════════════════════════════════════════════════════════

/**
 * Saves Firebase credentials to localStorage and immediately hot-swaps
 * the live Firebase instance without a page reload.
 *
 * Used by the InstallWizard's "Save to browser" fallback path,
 * and by the Admin Panel's manual config form.
 */
export async function saveRuntimeFirebaseConfig(
  cfg: FirebaseRuntimeConfig,
): Promise<void> {
  localStorage.setItem(DYNAMIC_FIREBASE_KEY, JSON.stringify(cfg));
  await reinitializeDynamicFirebase(cfg);
}

// ════════════════════════════════════════════════════════════════════════════
// NEW EXPORT: probeInstallHelper
// ════════════════════════════════════════════════════════════════════════════

/**
 * Silently probes the server to detect which save method is available.
 *
 *  'php'  → /install-helper.php or /public/install-helper.php responded (cPanel / PHP server)
 *  'node' → /api/save-config responded (Node.js / Express / Vercel fn)
 *  'none' → neither responded (pure static host — use download fallback)
 *
 * Uses a 3-second timeout per probe. Any HTTP response (even 403/405/500)
 * counts as "available" because it proves the server processed the request.
 * Only a network-level failure (timeout / DNS error) counts as "not available".
 */
export async function probeInstallHelper(): Promise<'php' | 'node' | 'none'> {
  // ── Probe PHP ─────────────────────────────────────────────────────────────
  for (const helperUrl of ['/install-helper.php', '/public/install-helper.php']) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(helperUrl, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeout);
      // Any HTTP status means PHP is running (200=ok, 405=method not allowed,
      // 403=forbidden, 500=php error — all prove the server processed it)
      if ([200, 403, 405, 500].includes(res.status)) {
        return 'php';
      }
    } catch {
      // Network error or timeout — try the next PHP helper location.
    }
  }

  // ── Probe Node ────────────────────────────────────────────────────────────
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('/api/save-config', {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    // Any response at all = Node endpoint exists
    if (res.status !== undefined) {
      return 'node';
    }
  } catch {
    // Network error or timeout — Node not available either
  }

  return 'none';
}

// ════════════════════════════════════════════════════════════════════════════
// EXISTING EXPORT: clearFirebaseConfig (unchanged)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Removes the runtime Firebase config from localStorage and tears down
 * the live Firestore/Auth instances. The app falls back to local mock mode
 * until new credentials are supplied.
 */
export function clearFirebaseConfig(): void {
  localStorage.removeItem(DYNAMIC_FIREBASE_KEY);
  const apps = getApps();
  apps.forEach(a => deleteApp(a).catch(() => {}));    _db           = null;
    _auth         = null;
    _activeSource = 'none';
    _notifyReady(false);
    console.log('[Firebase] Config cleared — reverted to local mock mode.');
}

// ════════════════════════════════════════════════════════════════════════════
// NEW EXPORT: disconnectFirebase (for engine switching in db.ts)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Tears down the live Firebase app without clearing localStorage config.
 * Called by AppContext.switchDbEngine() when switching to Supabase or Local.
 * The persisted config remains so the operator can switch back without
 * re-entering credentials.
 */
export async function disconnectFirebase(): Promise<void> {
  const apps = getApps().filter(a => a.name === '[DEFAULT]');
  for (const a of apps) {
    await deleteApp(a).catch(() => {});
  }    _app          = null;
    _db           = null;
    _auth         = null;
    _activeSource = 'none';
    _notifyReady(false);
    console.log('[Firebase] Disconnected.');
}

// ════════════════════════════════════════════════════════════════════════════
// EXISTING EXPORT: reinitializeDynamicFirebase (unchanged behaviour)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Validates credentials, tests the Firestore connection, then hot-swaps
 * the live Firebase instance if the test passes.
 *
 * Called by:
 *  - InstallWizard Step 3 "Test Connection" button
 *  - InstallWizard Step 6 Sub-step 1 install sequence
 *  - Admin Panel Firebase config form
 *  - saveRuntimeFirebaseConfig()
 */
export async function reinitializeDynamicFirebase(
  config: FirebaseRuntimeConfig,
): Promise<{ success: boolean; message: string }> {
  try {
    // ── 1. Required fields ────────────────────────────────────────────────
    if (!config.apiKey || !config.projectId || !config.authDomain) {
      throw new Error('API Key, Auth Domain and Project ID are required.');
    }
    if (!isValidFirebaseRuntimeConfig(config)) {
      throw new Error('Please paste real Firebase Web App credentials. Placeholder values like "your-project-id" cannot be used.');
    }

    // ── 2. Format validation (catches "ss" / "s" garbage early) ───────────
    const apiKey     = config.apiKey.trim();
    const projectId  = config.projectId.trim();
    const authDomain = config.authDomain.trim();

    if (!/^AIza[0-9A-Za-z_-]{35}$/.test(apiKey)) {
      throw new Error('Invalid API Key format. Firebase Web API keys start with "AIza" and are 39 characters long.');
    }
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
      throw new Error('Invalid Project ID. Use 6–30 lowercase letters, digits or hyphens (must start with a letter).');
    }
    if (!/^[a-z0-9-]+\.(firebaseapp\.com|web\.app)$/i.test(authDomain)) {
      throw new Error('Invalid Auth Domain. Expected "<project-id>.firebaseapp.com".');
    }

    // ── 3. Firestore reachability check ──────────────────────────────────
    //     Hits the REST runQuery endpoint. This validates BOTH the API key
    //     and the projectId together in one request — the correct check.
    //       • 200                          → DB exists & reachable
    //       • 401 / 403 PERMISSION_DENIED  → DB exists, rules deny → OK
    //       • 404 NOT_FOUND on database    → Firestore not provisioned yet
    //       • 400 with project-not-found   → bad projectId or bad API key
    //     Hits the REST runQuery endpoint. Works with just an API key.
    //       • 200                          → DB exists & reachable
    //       • 401 / 403 PERMISSION_DENIED  → DB exists, rules deny → OK
    //       • 404 NOT_FOUND on database    → Firestore not provisioned
    //       • 400 with project-not-found   → bad projectId
    const dbId = (config.databaseId || '(default)').trim() || '(default)';
    const fsUrl =
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
      `/databases/${encodeURIComponent(dbId)}/documents:runQuery?key=${encodeURIComponent(apiKey)}`;
    let f: Response;
    try {
      f = await fetch(fsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: '__lovable_probe__' }],
            limit: 1,
          },
        }),
      });
    } catch {
      throw new Error('Network error reaching Firestore.');
    }

    if (f.status === 404) {
      const txt = await f.text().catch(() => '');
      if (/database.*(not found|does not exist)|NOT_FOUND/i.test(txt)) {
        throw new Error(`Firestore database "${dbId}" is not provisioned for project "${projectId}". Open Firebase Console → Firestore Database → Create database.`);
      }
    } else if (f.status === 400) {
      const txt = await f.text().catch(() => '');
      if (/project.*(not found|does not exist|invalid)/i.test(txt)) {
        throw new Error(`Project "${projectId}" not found in Firebase.`);
      }
      // Other 400s (e.g. malformed query) shouldn't happen with our static body — ignore.
    } else if (f.status >= 500) {
      throw new Error(`Firestore service unavailable (${f.status}). Try again in a moment.`);
    }
    // 200 / 401 / 403 all confirm the project is real and reachable.


    // ── 4. All checks passed — persist & hot-swap the live SDK instance ──
    const testCfg = buildConfig({ ...config, apiKey, projectId, authDomain });

    localStorage.setItem(DYNAMIC_FIREBASE_KEY, JSON.stringify({
      ...config, apiKey, projectId, authDomain,
    }));

    const oldApps = getApps().filter(a => a.name === '[DEFAULT]');
    for (const a of oldApps) await deleteApp(a).catch(() => {});
    bootFirebase(testCfg, 'localstorage');

    return {
      success: true,
      message: `Firebase connected to project "${projectId}" successfully.`,
    };
  } catch (err: any) {
    console.warn('[Firebase] reinitializeDynamicFirebase failed:', err);
    // Re-throw so the caller (InstallWizard handleTestConnection) hits its
    // catch branch and shows the real reason instead of a green checkmark.
    throw new Error(err?.message || 'Connection failed. Check your credentials.');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PROXY GETTERS — always return the current live instance
// ════════════════════════════════════════════════════════════════════════════

export { _db as db, _auth as auth };

/** Returns the currently active Firestore instance, or throws if not initialised. */
export function getDb(): import('firebase/firestore').Firestore {
  if (!_db) throw new Error('Firebase is not initialised. Run reinitializeDynamicFirebase first.');
  return _db;
}

// ════════════════════════════════════════════════════════════════════════════
// FILE → BASE64 UTILITY (replaces all Firebase Storage upload paths)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Read a File object (from an `<input type="file">` or drag-and-drop) as a
 * base64 data URL string. This replaces all Firebase Storage upload paths.
 *
 * Images are stored directly as base64 strings in Firestore, which works
 * on the Firebase Spark (free) plan without enabling billing.
 *
 * ⚠️ LIMIT: Base64 encoding adds ~37% overhead. A 500 KB file → ~685 KB
 * base64 string. Firestore has a 1 MiB (1,048,576 bytes) document size
 * limit. Keep images under ~600 KB to stay safe.
 *
 * @param file - The File object to read
 * @returns A data URL string (e.g. "data:image/jpeg;base64,/9j/4AAQ...")
 * @throws If the file cannot be read
 */
export function fileToBase64(file: File): Promise<string> {
  // SVG: keep as-is (vector). Other images: resize+compress via canvas so the
  // resulting data URL stays well under Firestore's 1 MiB document limit and
  // never requires enabling Firebase Storage (paid plan).
  if (file.type === 'image/svg+xml') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target?.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  const MAX_DIM = 1000;       // px
  const QUALITY = 0.82;       // JPEG/WebP quality
  const TARGET_BYTES = 700_000; // ~700 KB cap (stays safely under 1 MiB)

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > MAX_DIM || height > MAX_DIM) {
            const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(dataUrl);
          ctx.drawImage(img, 0, 0, width, height);

          // Preserve transparency for PNG, otherwise use JPEG for smaller size
          const hasAlpha = file.type === 'image/png' || file.type === 'image/gif';
          const mime = hasAlpha ? 'image/png' : 'image/jpeg';
          let out = canvas.toDataURL(mime, QUALITY);

          // If still too big, step down quality / dimensions
          let q = QUALITY;
          let w = width, h = height;
          while (out.length > TARGET_BYTES && (q > 0.4 || w > 400)) {
            if (q > 0.4) {
              q -= 0.1;
            } else {
              w = Math.round(w * 0.8);
              h = Math.round(h * 0.8);
              canvas.width = w;
              canvas.height = h;
              ctx.drawImage(img, 0, 0, w, h);
            }
            out = canvas.toDataURL(hasAlpha ? 'image/jpeg' : mime, q);
          }
          resolve(out);
        } catch (err) {
          resolve(dataUrl); // fallback: original encoding
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Snapshot value — NOTE: this is read at import time and will be `false`
 * until the async boot completes. Prefer getIsFirebaseConfigured() for
 * live checks, or subscribe via onFirebaseReadyChange().
 */
export const isFirebaseConfigured: boolean = _ready;

/** Live getter — always returns the current ready state */
export function getIsFirebaseConfigured(): boolean {
  return _ready;
}

// ════════════════════════════════════════════════════════════════════════════
// ERROR HELPERS (unchanged)
// ════════════════════════════════════════════════════════════════════════════

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST   = 'list',
  GET    = 'get',
  WRITE  = 'write',
  READ   = 'read',
}

export interface FirestoreErrorInfo {
  error:         string;
  operationType: OperationType;
  path:          string | null;
  authInfo: {
    userId?:        string | null;
    email?:         string | null;
    emailVerified?: boolean | null;
    isAnonymous?:   boolean | null;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId:        _auth?.currentUser?.uid           ?? null,
      email:         _auth?.currentUser?.email         ?? null,
      emailVerified: _auth?.currentUser?.emailVerified ?? null,
      isAnonymous:   _auth?.currentUser?.isAnonymous   ?? null,
    },
    operationType,
    path,
  };
  console.error('[Firebase] Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
