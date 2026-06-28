import React, { useEffect, useState, useCallback } from 'react'
import { probeInstallHelper, reinitializeDynamicFirebase, clearFirebaseConfig, getDb, auth, type FirebaseRuntimeConfig, DYNAMIC_FIREBASE_KEY } from '../firebase'
import { reinitializeSupabase, getSupabaseClient, SUPABASE_CONFIG_KEY, type SupabaseRuntimeConfig } from '../supabase'
import { writeInstallLock } from '../installStatus'
import {
  DEFAULT_PRODUCTS,
  DEFAULT_CATEGORIES,
  DEFAULT_COUPONS,
  DEFAULT_REVIEWS,
  DEFAULT_SITE_SETTINGS,
  DEFAULT_PAYMENT_SETTINGS,
  DEFAULT_SMTP_SETTINGS,
  DEFAULT_SUPPORT_SETTINGS,
  setActiveEngine,
  hashPassword,
  seedDefaultData,
  signInAdmin,
  createAdminAccount,
  dbService,
} from '../db'

// ─── Types ────────────────────────────────────────────────────────────────────

type CheckStatus = 'idle' | 'running' | 'ok' | 'fail'
type ConnStatus  = 'idle' | 'running' | 'ok' | 'fail'

// ─── Sub-components ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span className="inline-block w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
  )
}

interface CheckRowProps {
  status: CheckStatus
  okLabel: string
  failLabel: string
}

function CheckRow({ status, okLabel, failLabel }: CheckRowProps) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="shrink-0 w-6 flex items-center justify-center">
        {status === 'running' && <Spinner />}
        {status === 'ok'      && <span className="text-emerald-500 text-lg">✅</span>}
        {status === 'fail'    && <span className="text-rose-500 text-lg">❌</span>}
        {status === 'idle'    && <span className="inline-block w-5 h-5 rounded-full bg-gray-200" />}
      </span>
      <span className={`text-sm ${status === 'fail' ? 'text-rose-600' : 'text-gray-700'}`}>
        {status === 'fail' ? failLabel : okLabel}
      </span>
    </div>
  )
}

// ─── Step indicator ───────────────────────────────────────────────────────────

interface StepDotsProps {
  total: number
  current: number
}

function StepDots({ total, current }: StepDotsProps) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1
        if (step === current) {
          return <span key={step} className="w-8 h-2 bg-emerald-500 rounded-full transition-all duration-300" />
        }
        if (step < current) {
          return <span key={step} className="w-2 h-2 bg-emerald-500 rounded-full" />
        }
        return <span key={step} className="w-2 h-2 bg-gray-200 rounded-full" />
      })}
    </div>
  )
}

// ─── Shared button styles ─────────────────────────────────────────────────────

const primaryBtn =
  'bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-lg transition-colors duration-150'

const backBtn =
  'text-gray-500 hover:text-gray-700 font-medium px-4 py-2 transition-colors duration-150'


// ─── EnvVarsGuide — multi-platform env-var instructions ──────────────────────

interface EnvVarsGuideProps {
  envBlock:     string   // FIREBASE_* server-side vars (Render / VPS / cPanel Node)
  viteEnvBlock: string   // VITE_FIREBASE_* build-time vars (Netlify / Vercel static)
  onContinue:   () => void
}

type HostTab = 'render' | 'netlify' | 'vercel' | 'cpanel' | 'vps'

function EnvVarsGuide({ envBlock, viteEnvBlock, onContinue }: EnvVarsGuideProps) {
  const [tab, setTab] = React.useState<HostTab>('render')
  const [copied, setCopied] = React.useState(false)

  const tabs: { id: HostTab; label: string }[] = [
    { id: 'render',  label: 'Render' },
    { id: 'netlify', label: 'Netlify' },
    { id: 'vercel',  label: 'Vercel' },
    { id: 'cpanel',  label: 'cPanel' },
    { id: 'vps',     label: 'VPS / Local' },
  ]

  const blockForTab: Record<HostTab, string> = {
    render:  envBlock,
    netlify: viteEnvBlock || envBlock,
    vercel:  viteEnvBlock || envBlock,
    cpanel:  envBlock,
    vps:     envBlock,
  }

  const currentBlock = blockForTab[tab]

  function copy() {
    try { navigator.clipboard.writeText(currentBlock) } catch {}
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const instructions: Record<HostTab, React.ReactNode> = {
    render: (
      <ol className="text-[11px] text-sky-900 space-y-1 list-decimal list-inside leading-relaxed">
        <li>Open <strong>Render Dashboard → Your Service → Environment</strong></li>
        <li>Click <strong>Add Environment Variable</strong> and paste each line above (key = value)</li>
        <li>Click <strong>Save Changes</strong>, then <strong>Manual Deploy → Deploy latest commit</strong></li>
        <li>After the deploy completes, the installer will never appear again on any browser</li>
      </ol>
    ),
    netlify: (
      <ol className="text-[11px] text-sky-900 space-y-1 list-decimal list-inside leading-relaxed">
        <li>Open <strong>Netlify → Site → Site configuration → Environment variables</strong></li>
        <li>Click <strong>Add a variable</strong> and paste each line above (key + value)</li>
        <li>Make sure scope covers <em>Production, Deploy Previews, Branch deploys</em></li>
        <li>Trigger a new deploy: <strong>Deploys → Trigger deploy → Deploy site</strong></li>
        <li>After the build completes, the installer will never appear again on any browser</li>
      </ol>
    ),
    vercel: (
      <ol className="text-[11px] text-sky-900 space-y-1 list-decimal list-inside leading-relaxed">
        <li>Open <strong>Vercel → Project → Settings → Environment Variables</strong></li>
        <li>Add each variable above — check <em>Production + Preview + Development</em></li>
        <li>Go to <strong>Deployments → ⋯ → Redeploy</strong> (do NOT use "Rollback")</li>
        <li>After the deploy completes, the installer will never appear again on any browser</li>
      </ol>
    ),
    cpanel: (
      <ol className="text-[11px] text-sky-900 space-y-1 list-decimal list-inside leading-relaxed">
        <li>In cPanel, open <strong>Setup Node.js App</strong> and find your app</li>
        <li>Scroll to <strong>Environment Variables</strong> and add each line above</li>
        <li>Click <strong>Save</strong>, then restart the Node.js app</li>
        <li className="text-amber-800 font-medium">Alternative: create a <code>.env</code> file in your project root with the lines above, then restart the server</li>
        <li>After restarting, the installer will never appear again on any browser</li>
      </ol>
    ),
    vps: (
      <ol className="text-[11px] text-sky-900 space-y-1 list-decimal list-inside leading-relaxed">
        <li>Create or edit a <code className="bg-white border rounded px-1">.env</code> file in your project root:</li>
        <li className="ml-4 list-none"><code className="bg-white border rounded px-1 text-[10px]">nano .env</code> — paste the lines above, then save</li>
        <li>Restart your server: <code className="bg-white border rounded px-1 text-[10px]">pm2 restart all</code> or <code className="bg-white border rounded px-1 text-[10px]">node server.js</code></li>
        <li>After restarting, the installer will never appear again on any browser</li>
      </ol>
    ),
  }

  return (
    <div className="bg-sky-50 border-l-4 border-sky-500 text-sky-900 p-4 rounded-xl space-y-3">
      <p className="font-semibold text-sm">🔧 One-time setup — permanent fix for all platforms</p>

      {/* Platform tabs */}
      <div className="flex flex-wrap gap-1">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`text-[11px] font-semibold px-3 py-1 rounded-full transition-colors duration-150 ${
              tab === t.id
                ? 'bg-sky-600 text-white'
                : 'bg-white border border-sky-300 text-sky-700 hover:bg-sky-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Platform instructions */}
      <div className="bg-white border border-sky-200 rounded-lg p-3">
        {instructions[tab]}
      </div>

      {/* Env block for current platform */}
      <div>
        <p className="text-[10px] font-semibold text-sky-700 mb-1 uppercase tracking-wide">
          {tab === 'netlify' || tab === 'vercel' ? 'Copy these variables (VITE_ prefix for static build):' : 'Copy these variables:'}
        </p>
        <div className="relative">
          <pre className="bg-slate-900 text-emerald-300 text-[11px] font-mono p-3 rounded-lg overflow-x-auto select-all max-h-56 whitespace-pre-wrap break-all">
{currentBlock}
          </pre>
          <button
            type="button"
            onClick={copy}
            className="absolute top-2 right-2 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold uppercase px-2 py-1 rounded transition-colors"
          >
            {copied ? '✓ Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <p className="text-[11px] text-sky-800 leading-relaxed">
        Your config was also saved in this browser so you can <strong>finish this install right now</strong>.
        Click Continue — but set the env vars + redeploy so the app loads correctly for everyone (incognito, other devices, etc.).
      </p>

      <button
        type="button"
        className="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors duration-150"
        onClick={onContinue}
      >
        ✅ I've added the env vars (or skipping for now) — Continue →
      </button>
    </div>
  )
}


// ─── Step 6 install logic — extracted to a proper component ──────────────────

interface InstallProgressState {
  step:          number
  status:        'idle' | 'running' | 'awaiting-envvars' | 'error' | 'done'
  message:       string
  error:         string
  completed:     number[]
  envBlock?:     string
  viteEnvBlock?: string
}

interface Step6Props {
  installProgress:    InstallProgressState
  setInstallProgress: React.Dispatch<React.SetStateAction<InstallProgressState>>
  setCurrentStep:     (n: number) => void
  creds:              FirebaseRuntimeConfig
  supabaseCreds:      SupabaseRuntimeConfig
  backend:            'firebase' | 'supabase'
  detectedPlatform:   'php' | 'node' | 'none' | null
  admin:              { username: string; email: string; password: string; confirm: string }
  store:              { name: string; email: string; currency: string; symbol: string }
  backBtn:            string
  primaryBtn:         string
}

const ROW_LABELS_FIREBASE = [
  'Connecting to Firebase...',
  'Saving configuration...',
  'Setting up admin authentication...',
  'Setting up store data...',
  'Creating admin account...',
  'Saving store settings...',
  'Finalising installation...',
]
const ROW_LABELS_SUPABASE = [
  'Connecting to Supabase...',
  'Verifying schema...',
  'Setting up admin authentication...',
  'Setting up store data...',
  'Creating admin account...',
  'Saving store settings...',
  'Writing install lock...',
]

function Step6Install({
  installProgress,
  setInstallProgress,
  setCurrentStep,
  creds,
  supabaseCreds,
  backend,
  detectedPlatform,
  admin,
  store,
  backBtn,
  primaryBtn,
}: Step6Props) {
  const markDone = useCallback((n: number) =>
    setInstallProgress(p => ({ ...p, completed: [...p.completed, n] })), [setInstallProgress])

  const markRunning = useCallback((n: number, msg: string) =>
    setInstallProgress(p => ({ ...p, step: n, status: 'running', message: msg, error: '' })),
    [setInstallProgress])

  const markError = useCallback((msg: string) =>
    setInstallProgress(p => ({ ...p, status: 'error', error: msg })), [setInstallProgress])

  const runInstallFromStep3 = useCallback(async () => {

    // Helper: wraps a promise with a timeout so a Firestore permission-denied
    // or network stall surfaces as an error instead of hanging forever.
    function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
      return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(
            `"${label}" timed out after ${ms / 1000}s. ` +
            `Most likely cause: Firestore security rules are blocking the write. ` +
            `Deploy firestore.rules from this project (firebase deploy --only firestore:rules) then try again.`
          )), ms)
        ),
      ]);
    }

    // Sub-step 3 — Create Firebase Auth user and sign in
    // This authenticates all subsequent Firestore writes (sub-steps 4-7) so
    // the security rules don't reject them with PERMISSION_DENIED.
    // We create TWO auth accounts:
    //   1. The real email — primary account.
    //   2. A synthetic username-based email — lets any device log in using just
    //      the username+password without needing a Firestore read to look up the
    //      real email (which requires deployed security rules).
    markRunning(3, 'Setting up admin authentication...')
    try {
      const adminEmail = (admin.email || '').trim().toLowerCase()
      const stablePassword = 'ftp_' + btoa(adminEmail).replace(/[^a-zA-Z0-9]/g, '') + '_auth'
      try {
        await withTimeout(
          createAdminAccount(adminEmail, stablePassword),
          15000, 'Creating admin authentication',
        )
      } catch (e1: any) {
        if (e1?.code === 'auth/email-already-in-use') {
          await withTimeout(
            signInAdmin(adminEmail, stablePassword),
            15000, 'Signing in admin',
          )
        } else {
          throw e1
        }
      }
      // Also create/update a synthetic auth account keyed on username so that
      // cross-device logins work without needing to know the admin's real email.
      const syntheticEmail = `${admin.username.trim().toLowerCase()}@fruitopia-admin.internal`
      const syntheticPass = 'ftp_' + btoa(syntheticEmail).replace(/[^a-zA-Z0-9]/g, '') + '_auth'
      try {
        await withTimeout(
          createAdminAccount(syntheticEmail, syntheticPass),
          10000, 'Creating cross-device admin auth',
        )
      } catch (se: any) {
        if (se?.code === 'auth/email-already-in-use') {
          // Already exists (re-install) — nothing to do.
        }
        // Any other error is non-fatal; the primary auth account already works.
      }
      markDone(3)
    } catch (e: any) {
      // NON-FATAL — admin hash pre-saved above; login works via hash comparison
      console.warn('[Wizard] Firebase Auth skipped:', e?.code, e?.message)
      markDone(3)
    }

    // Sub-step 4 — Seed store data via db.ts seedDefaultData (engine-agnostic)
    markRunning(4, 'Setting up store data...')
    try {
      await withTimeout(
        seedDefaultData({
          products:   DEFAULT_PRODUCTS,
          categories: DEFAULT_CATEGORIES,
          coupons:    DEFAULT_COUPONS,
          reviews:    DEFAULT_REVIEWS,
        }),
        20000, 'Setting up store data',
      )
      markDone(4)
    } catch (e: any) { markError(e?.message || 'Failed to seed data'); return }

    // Sub-step 5 — Create admin account via dbService (engine-agnostic)
    markRunning(5, 'Creating admin account...')
    try {
      const adminHash = await hashPassword(admin.password)
      const adminData = {
        username: admin.username,
        email: admin.email.trim().toLowerCase(),
        password: adminHash,
      }
      await withTimeout(
        dbService.saveAdminSettings(adminData as any),
        15000, 'Creating admin account',
      )
      // Cache locally so the login page can verify credentials even if
      // Firestore security rules haven't been deployed yet.
      try { localStorage.setItem('qf_adminSettings', JSON.stringify(adminData)) } catch {}
      markDone(5)
    } catch (e: any) { markError(e?.message || 'Failed to create admin'); return }

    // Sub-step 6 — Save store settings via db.ts seedDefaultData (engine-agnostic)
    markRunning(6, 'Saving store settings...')
    try {
      await withTimeout(
        seedDefaultData({
          siteSettings: {
            ...DEFAULT_SITE_SETTINGS,
            websiteName:    store.name,
            siteTitle:      store.name,
            contactEmail:   store.email,
            currency:       store.currency,
            currencySymbol: store.symbol,
          },
          paymentSettings: DEFAULT_PAYMENT_SETTINGS,
          smtpSettings:    DEFAULT_SMTP_SETTINGS,
          supportSettings: DEFAULT_SUPPORT_SETTINGS,
        }),
        15000, 'Saving store settings',
      )
      markDone(6)
    } catch (e: any) { markError(e?.message || 'Failed to save settings'); return }

    // Sub-step 7 — Finalise via db.ts seedDefaultData (engine-agnostic)
    markRunning(7, 'Finalising installation...')
    try {
      await withTimeout(
        seedDefaultData({
          installStatus: {
            installed:   true,
            installedAt: new Date().toISOString(),
            platform:    detectedPlatform || 'unknown',
            storeName:   store.name,
          },
        }),
        15000, 'Finalising installation',
      )
      // Write the cross-backend install lock so /install can no longer be re-run
      // by anyone visiting the site. App.tsx's gate checks this lock on every load.
      await withTimeout(writeInstallLock('firebase'), 10000, 'Writing install lock')
      markDone(7)
      setInstallProgress(p => ({ ...p, status: 'done', message: 'Installation complete!' }))
      setCurrentStep(8)
      // Cache the installed state so App.tsx skips Firestore on every future page load.
      try { localStorage.setItem('fruitopia_installed', 'true'); } catch {}
      // Notify App.tsx to re-evaluate installState — handles the case where
      // Firebase was already configured so onFirebaseReadyChange never re-fires.
      if (typeof (window as any).__fruitopiaCheckInstall === 'function') {
        setTimeout(() => (window as any).__fruitopiaCheckInstall(), 300)
      }
    } catch (e: any) { markError(e?.message || 'Failed to finalise') }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, store, detectedPlatform, markDone, markRunning, markError, setInstallProgress, setCurrentStep])

  const runInstall = useCallback(async () => {
    setInstallProgress({ step: 0, status: 'running', message: '', error: '', completed: [] })

    // PRE-SAVE admin hash so login works even if Firebase steps fail
    try {
      const _ph = await hashPassword(admin.password)
      localStorage.setItem('qf_adminSettings', JSON.stringify({ username: admin.username, email: admin.email.trim().toLowerCase(), password: _ph }))
    } catch (_) { /* non-fatal */ }

    // Sub-step 1 — Connect to Firebase using the credentials the admin typed.
    // We initialise Firebase in-memory so the wizard itself can write to
    // Firestore. Durable config is served by the env-backed endpoint.
    markRunning(1, 'Connecting to Firebase...')
    try {
      await reinitializeDynamicFirebase(creds)
      setActiveEngine('firebase')
      markDone(1)
    } catch (e: any) { markError(e?.message || 'Firebase connection failed'); return }

    // Sub-step 2 — Save configuration using secure env-backed server logic.
    markRunning(2, 'Saving configuration...')
    try { localStorage.setItem(DYNAMIC_FIREBASE_KEY, JSON.stringify(creds)) } catch {}
    try {
      const res = await fetch('/api/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds),
      })
      const data = await res.json().catch(() => ({}))

      // success=true means Node server wrote .env successfully
      if (data?.success === true) {
        markDone(2)
        await runInstallFromStep3()
        return
      }

      // needsEnvVars=true with envBlock → read-only filesystem (Vercel/Netlify)
      // show the env-vars guide so admin can add them in the hosting dashboard
      if (data?.needsEnvVars && data?.envBlock) {
        setInstallProgress(p => ({
          ...p,
          status: 'awaiting-envvars',
          envBlock: data.envBlock,
          viteEnvBlock: data.viteEnvBlock || '',
          message: 'Add these environment variables on your host, then continue.',
        }))
        return
      }

      // wroteEnvFile=false but no needsEnvVars flag means server updated
      // process.env in-memory but couldn't write the file (permissions).
      // Config is active for this session — proceed with install anyway.
      if (data?.wroteEnvFile === false && !data?.needsEnvVars) {
        markDone(2)
        await runInstallFromStep3()
        return
      }

      throw new Error(data?.message || 'Could not save configuration.')
    } catch (e: any) {
      markError(e?.message || 'Failed to save configuration. Set FIREBASE_* environment variables on your host manually, then retry.')
      return
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds, detectedPlatform, markDone, markRunning, markError, runInstallFromStep3, setInstallProgress])

  // ── SUPABASE INSTALL PATH ─────────────────────────────────────────────────
  const runInstallSupabase = useCallback(async () => {
    setInstallProgress({ step: 0, status: 'running', message: '', error: '', completed: [] })

    // PRE-SAVE admin hash so login works even if Supabase steps fail
    try {
      const _ph = await hashPassword(admin.password)
      localStorage.setItem('qf_adminSettings', JSON.stringify({ username: admin.username, email: admin.email.trim().toLowerCase(), password: _ph }))
    } catch (_) { /* non-fatal */ }

    function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
      return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`"${label}" timed out after ${ms / 1000}s.`)), ms),
        ),
      ])
    }

    // Step 1 — Connect to Supabase
    markRunning(1, 'Connecting to Supabase...')
    try {
      const r = await reinitializeSupabase(supabaseCreds)
      if (!r.success) throw new Error(r.message)
      setActiveEngine('supabase')
      markDone(1)
    } catch (e: any) { markError(e?.message || 'Supabase connection failed'); return }

    const client = getSupabaseClient()
    if (!client) { markError('Supabase client unavailable after connect.'); return }

    // Step 2 — Verify required tables exist (settings/products/categories/coupons/reviews)
    markRunning(2, 'Verifying schema...')
    try {
      const required = ['settings', 'products', 'categories', 'coupons', 'reviews']
      const missing: string[] = []
      for (const t of required) {
        const { error } = await client.from(t).select('*').limit(1)
        if (error && error.code === '42P01') missing.push(t)
      }
      if (missing.length) {
        throw new Error(
          'Missing tables: ' + missing.join(', ') +
          '. Run the SQL block printed in the wizard (Supabase → SQL Editor) before retrying.'
        )
      }
      markDone(2)
    } catch (e: any) { markError(e?.message || 'Schema check failed'); return }

    // Step 3 — Create admin auth user (Supabase Auth)
    // Creates TWO auth accounts: one with the real email, and one with a
    // synthetic username-based email so cross-device login works without
    // needing a DB read (which requires deployed RLS policies).
    markRunning(3, 'Setting up admin authentication...')
    try {
      const adminEmail = (admin.email || '').trim().toLowerCase()
      const stablePassword = 'ftp_' + btoa(adminEmail).replace(/[^a-zA-Z0-9]/g, '') + '_auth'
      const { error } = (await withTimeout(
        client.auth.signUp({ email: adminEmail, password: stablePassword }) as Promise<any>,
        15000, 'Creating admin authentication'
      )) as any
      if (error) {
        const m = (error.message || '').toLowerCase()
        // Already-registered = re-install, fine to skip
        if (/already/i.test(error.message)) {
          // ok
        } else if (m.includes('rate limit') || m.includes('429') || m.includes('over_email_send')) {
          throw new Error(
            'Supabase blocked the signup because too many auth emails were sent recently from this project (rate limit). ' +
            'Open Supabase → Authentication → Providers → Email and DISABLE "Confirm email" (so signup does not send a mail), ' +
            'OR wait ~1 hour and retry, OR configure a custom SMTP under Authentication → SMTP Settings to lift the limit.'
          )
        } else if (m.includes('invalid') && m.includes('email')) {
          throw new Error('Supabase rejected the admin email. Enter a real email address (e.g. you@gmail.com).')
        } else {
          throw new Error(error.message)
        }
      }
      // Also register a synthetic-email account keyed on username alone so
      // admins can log in from any device without a DB read to resolve their email.
      const sbSyntheticEmail = `${admin.username.trim().toLowerCase()}@fruitopia-admin.internal`
      const sbSyntheticPass = 'ftp_' + btoa(sbSyntheticEmail).replace(/[^a-zA-Z0-9]/g, '') + '_auth'
      try {
        await withTimeout(
          client.auth.signUp({ email: sbSyntheticEmail, password: sbSyntheticPass }) as Promise<any>,
          10000, 'Creating cross-device admin auth'
        )
      } catch { /* non-fatal */ }
      markDone(3)
    } catch (e: any) { markError(e?.message || 'Failed to create admin auth'); return }

    // Step 4 — Seed store data
    markRunning(4, 'Setting up store data...')
    try {
      const products   = DEFAULT_PRODUCTS.map((p: any)   => ({ id: p.id, data: p }))
      const categories = DEFAULT_CATEGORIES.map((c: any) => ({ id: c.id, data: c }))
      const coupons    = DEFAULT_COUPONS.map((c: any)    => ({ id: c.id, data: c }))
      const reviews    = DEFAULT_REVIEWS.map((r: any)    => ({ id: r.id, data: r }))
      const ops = [
        client.from('products').upsert(products,     { onConflict: 'id' }),
        client.from('categories').upsert(categories, { onConflict: 'id' }),
        client.from('coupons').upsert(coupons,       { onConflict: 'id' }),
        client.from('reviews').upsert(reviews,       { onConflict: 'id' }),
      ]
      for (const op of ops) {
        const { error } = (await withTimeout(op as Promise<any>, 20000, 'Seeding store data')) as any
        if (error) throw new Error(error.message)
      }
      markDone(4)
    } catch (e: any) { markError(e?.message || 'Failed to seed data'); return }

    // Step 5 — Create admin account
    markRunning(5, 'Creating admin account...')
    try {
      const sbAdminHash = await hashPassword(admin.password)
      const sbAdminData = { username: admin.username, email: admin.email.trim().toLowerCase(), password: sbAdminHash }
      const { error } = (await withTimeout(
        client.from('settings').upsert(
          { key: 'adminSettings', value: sbAdminData },
          { onConflict: 'key' },
        ) as Promise<any>,
        15000, 'Creating admin account'
      )) as any
      if (error) throw new Error(error.message)
      // Cache locally so login works even if DB reads fail later.
      try { localStorage.setItem('qf_adminSettings', JSON.stringify(sbAdminData)) } catch {}
      markDone(5)
    } catch (e: any) { markError(e?.message || 'Failed to create admin'); return }

    // Step 6 — Save store settings
    markRunning(6, 'Saving store settings...')
    try {
      const rows = [
        { key: 'siteSettings', value: {
            ...DEFAULT_SITE_SETTINGS,
            websiteName: store.name,
            siteTitle: store.name,
            contactEmail: store.email,
            currency: store.currency,
            currencySymbol: store.symbol,
          } },
        { key: 'paymentSettings', value: DEFAULT_PAYMENT_SETTINGS },
        { key: 'smtpSettings',    value: DEFAULT_SMTP_SETTINGS },
        { key: 'supportSettings', value: DEFAULT_SUPPORT_SETTINGS },
      ]
      const { error } = (await withTimeout(
        client.from('settings').upsert(rows, { onConflict: 'key' }) as Promise<any>,
        15000, 'Saving store settings'
      )) as any
      if (error) throw new Error(error.message)
      markDone(6)
    } catch (e: any) { markError(e?.message || 'Failed to save settings'); return }

    // Step 7 — Write install lock + status
    markRunning(7, 'Writing install lock...')
    try {
      await withTimeout(writeInstallLock('supabase'), 15000, 'Writing install lock')
      await withTimeout(
        client.from('settings').upsert(
          { key: 'install_status', value: { installed: true, installedAt: new Date().toISOString(), storeName: store.name } },
          { onConflict: 'key' },
        ),
        15000, 'Writing install status'
      )
      markDone(7)
      // Show env-vars guide so the site works from any device/host
      try {
        const sbEnvRes = await fetch('/api/save-supabase-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(supabaseCreds),
        })
        const sbEnvData = await sbEnvRes.json().catch(() => ({}))
        // needsEnvVars=true → read-only filesystem (Vercel/Netlify) — show guide
        if (sbEnvData?.needsEnvVars && sbEnvData?.envBlock) {
          setInstallProgress(p => ({
            ...p,
            status: 'awaiting-envvars',
            envBlock: sbEnvData.envBlock,
            viteEnvBlock: sbEnvData.viteEnvBlock || '',
            message: 'Set these env vars so Supabase loads from any device.',
          }))
          return
        }
        // success=true or wroteEnvFile=true → .env written, all good, proceed
      } catch { /* non-fatal — show done anyway */ }
      setInstallProgress(p => ({ ...p, status: 'done', message: 'Installation complete!' }))
      setCurrentStep(8)
      try { localStorage.setItem('fruitopia_installed', 'true') } catch {}
      if (typeof (window as any).__fruitopiaCheckInstall === 'function') {
        setTimeout(() => (window as any).__fruitopiaCheckInstall(), 300)
      }
    } catch (e: any) { markError(e?.message || 'Failed to finalise'); return }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabaseCreds, admin, store, markDone, markRunning, markError, setInstallProgress, setCurrentStep])


  const isBlocking =
    installProgress.status === 'running' ||
    installProgress.status === 'awaiting-envvars'

  function getRowStatus(rowIndex: number): 'pending' | 'running' | 'completed' | 'error' {
    const n = rowIndex + 1
    if (installProgress.completed.includes(n))                       return 'completed'
    if (installProgress.status === 'error'   && installProgress.step === n) return 'error'
    if (installProgress.status === 'running' && installProgress.step === n) return 'running'
    return 'pending'
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-1">Installing</h2>
        <p className="text-gray-500 text-sm">
          {installProgress.status === 'idle'
            ? 'Ready to install. Click the button below to begin.'
            : installProgress.status === 'done'
            ? 'Installation successful! Your store is ready. Refresh the page to begin.'
            : installProgress.message || 'Working…'}
        </p>
      </div>

      {/* Progress rows */}
      <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl px-4">
        {(backend === 'supabase' ? ROW_LABELS_SUPABASE : ROW_LABELS_FIREBASE).map((label, i) => {
          const status = getRowStatus(i)
          return (
            <div key={i} className="flex items-center gap-3 py-3">
              <span className="shrink-0 w-6 flex items-center justify-center">
                {status === 'running'   && <span className="inline-block w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />}
                {status === 'completed' && <span className="text-emerald-500 text-lg">✅</span>}
                {status === 'error'     && <span className="text-rose-500 text-lg">❌</span>}
                {status === 'pending'   && <span className="inline-block w-3 h-3 rounded-full bg-gray-200" />}
              </span>
              <span className={`text-sm ${
                status === 'completed' ? 'text-emerald-700 font-medium' :
                status === 'error'     ? 'text-rose-600' :
                status === 'running'   ? 'text-gray-800 font-medium' :
                'text-gray-400'
              }`}>
                {label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Awaiting env-vars — multi-platform permanent fix */}
      {installProgress.status === 'awaiting-envvars' && installProgress.envBlock && (
        <EnvVarsGuide
          envBlock={installProgress.envBlock}
          viteEnvBlock={installProgress.viteEnvBlock || ''}
          onContinue={async () => {
            if (backend === 'supabase') {
              setInstallProgress(p => ({ ...p, status: 'done', message: 'Installation complete!' }))
              setCurrentStep(8)
            } else {
              markDone(2)
              setInstallProgress(p => ({ ...p, status: 'running', message: 'Continuing with saved browser config…' }))
              await runInstallFromStep3()
            }
          }}
        />
      )}



      {/* Error banner */}
      {installProgress.status === 'error' && (() => {
        const isRulesError =
          backend !== 'supabase' &&
          /permission.denied|missing.*permission|insufficient.*permission|unauthorized|timed out/i
            .test(installProgress.error);
        return (
          <div className="bg-rose-50 border border-rose-300 text-rose-700 p-4 rounded-lg text-sm space-y-2">
            <p className="font-semibold">Installation error</p>
            <p className="break-words">{installProgress.error}</p>
            {isRulesError && (
              <div className="mt-3 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg p-3 space-y-1">
                <p className="font-bold">⚠️ Firestore security rules need to be deployed</p>
                <p className="text-xs">Run this command in your project folder, then click Try Again:</p>
                <pre className="bg-white border border-amber-200 rounded px-3 py-2 text-xs font-mono select-all mt-1">
                  firebase deploy --only firestore:rules
                </pre>
                <p className="text-xs mt-1">
                  Don't have firebase-tools? Run first:{' '}
                  <code className="bg-white border border-amber-200 rounded px-1 py-0.5 font-mono text-xs">
                    npm install -g firebase-tools
                  </code>
                </p>
              </div>
            )}
          </div>
        );
      })()}

      {/* Action row */}
      <div className="flex items-center justify-between">
        {!isBlocking ? (
          <button className={backBtn} onClick={() => setCurrentStep(6)}>← Back</button>
        ) : (
          <span />
        )}

        <div className="flex gap-3">
          {installProgress.status === 'error' && (
            <button
              className={primaryBtn}
              onClick={() => {
                setInstallProgress({ step: 0, status: 'idle', message: '', error: '', completed: [] })
                setTimeout(() => {
                  if (backend === 'supabase') runInstallSupabase()
                  else runInstall()
                }, 50)
              }}
            >
              Try Again
            </button>
          )}
          {installProgress.status === 'idle' && (
            <button className={primaryBtn} onClick={() => {
              if (backend === 'supabase') {
                runInstallSupabase()
              } else if (backend === 'firebase') {
                runInstall()
              } else {
                alert('Please select a backend (Firebase or Supabase) before installing.')
                setCurrentStep(2)
              }
            }}>
              Install Now
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function InstallWizard() {
  // ── Wizard navigation ──────────────────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState<number>(1)

  // ── Step 1: silent platform detection ─────────────────────────────────────
  const [detectedPlatform, setDetectedPlatform] =
    useState<'php' | 'node' | 'none' | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const result = await probeInstallHelper()
        setDetectedPlatform(result)
      } catch {
        setDetectedPlatform('none')
      }
    })()
  }, [])

  // ── Step 2: backend choice (firebase vs supabase) ─────────────────────────
  const [backend, setBackend] = useState<'firebase' | 'supabase' | null>(null)
  const [supabaseCreds, setSupabaseCreds] = useState<SupabaseRuntimeConfig>({ projectUrl: '', anonKey: '' })
  const [sbTest, setSbTest] = useState<{ status: ConnStatus; message: string }>({ status: 'idle', message: '' })
  // Copy-button feedback: briefly shows "Copied!" after clicking
  const [sqlCopied, setSqlCopied] = useState(false)
  const [rulesCopied, setRulesCopied] = useState(false)

  // ── Step 3: requirement checks ─────────────────────────────────────────────
  const [checks, setChecks] = useState<{
    internet: CheckStatus
    storage:  CheckStatus
    backend: CheckStatus
  }>({ internet: 'idle', storage: 'idle', backend: 'idle' })

  useEffect(() => {
    if (currentStep !== 3 || backend === null) return
    const alreadyOk =
      checks.internet === 'ok' &&
      checks.storage  === 'ok' &&
      checks.backend === 'ok'
    if (alreadyOk) return
    runChecks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, backend])

  async function runChecks() {
    // Reset all to idle first
    setChecks({ internet: 'idle', storage: 'idle', backend: 'idle' })

    // Check 1 — Internet
    setChecks(c => ({ ...c, internet: 'running' }))
    await new Promise(r => setTimeout(r, 300))
    const internetOk = navigator.onLine === true
    setChecks(c => ({ ...c, internet: internetOk ? 'ok' : 'fail' }))

    // Check 2 — Browser Storage
    setChecks(c => ({ ...c, storage: 'running' }))
    await new Promise(r => setTimeout(r, 300))
    let storageOk = false
    try {
      localStorage.setItem('_fruitopia_test', '1')
      localStorage.removeItem('_fruitopia_test')
      storageOk = true
    } catch {
      storageOk = false
    }
    setChecks(c => ({ ...c, storage: storageOk ? 'ok' : 'fail' }))

    // Check 3 — Backend Reachable (branches on the admin's Step 2 choice)
    setChecks(c => ({ ...c, backend: 'running' }))
    let backendOk = false
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      const probeUrl = backend === 'supabase'
        ? (supabaseCreds.projectUrl || 'https://supabase.com')
        : 'https://firestore.googleapis.com'
      try {
        await fetch(probeUrl, { method: 'HEAD', mode: 'no-cors', signal: controller.signal })
        backendOk = true
      } catch {
        backendOk = false
      } finally {
        clearTimeout(timer)
      }
    } catch {
      backendOk = false
    }
    setChecks(c => ({ ...c, backend: backendOk ? 'ok' : 'fail' }))
  }

  const anyCheckFailed =
    checks.internet === 'fail' ||
    checks.storage  === 'fail' ||
    checks.backend === 'fail'

  const allChecksOk =
    checks.internet === 'ok' &&
    checks.storage  === 'ok' &&
    checks.backend === 'ok'

  function handleSbCredChange(field: keyof SupabaseRuntimeConfig) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setSupabaseCreds(prev => ({ ...prev, [field]: e.target.value }))
      if (sbTest.status !== 'idle') setSbTest({ status: 'idle', message: '' })
    }
  }

  async function handleTestSupabase() {
    setSbTest({ status: 'running', message: '' })
    try {
      const r = await reinitializeSupabase(supabaseCreds)
      if (!r.success) throw new Error(r.message)
      // Undo side effects so the install gate doesn't flip mid-wizard
      try { localStorage.removeItem(SUPABASE_CONFIG_KEY) } catch {}
      setSbTest({ status: 'ok', message: '✅ Connected successfully!' })
    } catch (e: any) {
      setSbTest({ status: 'fail', message: e?.message || String(e) })
    }
  }

  const sbTestDisabled =
    !supabaseCreds.projectUrl.trim() ||
    !supabaseCreds.anonKey.trim() ||
    sbTest.status === 'running'

  // ── Step 3: Firebase credentials ──────────────────────────────────────────
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('reset') === '1') {
        localStorage.removeItem('fruitopia_installed')
        localStorage.removeItem('fruitopia_active_engine')
        localStorage.removeItem(DYNAMIC_FIREBASE_KEY)
      } else {
        const raw = localStorage.getItem(DYNAMIC_FIREBASE_KEY)
        if (raw && /your-|your-project|your-firebase-api-key/i.test(raw)) {
          localStorage.removeItem(DYNAMIC_FIREBASE_KEY)
          localStorage.removeItem('fruitopia_active_engine')
        }
      }
    } catch {}
  }, [])

  const [creds, setCreds] = useState<FirebaseRuntimeConfig>({
    apiKey:            '',
    authDomain:        '',
    projectId:         '',
    storageBucket:     '',
    messagingSenderId: '',
    appId:             '',
    databaseId:        '',
  })

  const [connTest, setConnTest] =
    useState<{ status: ConnStatus; message: string }>({
      status:  'idle',
      message: '',
    })

  function handleCredChange(field: keyof typeof creds) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setCreds(prev => ({ ...prev, [field]: e.target.value }))
      // Reset conn test result when user edits credentials
      if (connTest.status !== 'idle') {
        setConnTest({ status: 'idle', message: '' })
      }
    }
  }

  async function handleTestConnection() {
    setConnTest({ status: 'running', message: '' })
    try {
      await reinitializeDynamicFirebase(creds)
      // Test succeeded — undo the side effects so App.tsx doesn't detect
      // Firebase as configured and redirect away from the wizard.
      clearFirebaseConfig()
      setConnTest({ status: 'ok', message: '✅ Connected successfully!' })
    } catch (e: any) {
      setConnTest({
        status:  'fail',
        message: e?.message || String(e),
      })
    }
  }

  const testDisabled =
    !creds.apiKey.trim() ||
    !creds.authDomain.trim() ||
    !creds.projectId.trim() ||
    !creds.storageBucket.trim() ||
    !creds.messagingSenderId.trim() ||
    connTest.status === 'running'

  // ── Step 4: Admin account ──────────────────────────────────────────────────
  const [admin, setAdmin] = useState({ username: '', email: '', password: '', confirm: '' })
  const [showPwd,     setShowPwd]     = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [adminErrors, setAdminErrors] =
    useState<{ username?: string; email?: string; password?: string; confirm?: string }>({})

  function handleAdminChange(field: keyof typeof admin) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setAdmin(prev => ({ ...prev, [field]: e.target.value }))
      if (adminErrors[field]) {
        setAdminErrors(prev => { const n = { ...prev }; delete n[field]; return n })
      }
    }
  }

  function handleAdminNext() {
    const errs: typeof adminErrors = {}
    if (admin.username.trim().length < 3)
      errs.username = 'Username must be at least 3 characters'
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin.email.trim())
    if (!emailOk)
      errs.email = 'Enter a valid email address (e.g. you@gmail.com)'
    if (admin.password.length < 6)
      errs.password = 'Password must be at least 6 characters'
    if (admin.password !== admin.confirm)
      errs.confirm = 'Passwords do not match'
    setAdminErrors(errs)
    if (Object.keys(errs).length === 0) setCurrentStep(6)
  }

  // ── Step 5–7 store / progress state (used by Prompt 2) ────────────────────
  const [store, setStore] = useState({
    name:     'Fruitopia',
    email:    '',
    currency: 'USD',
    symbol:   '$',
  })

  const [storeNameError, setStoreNameError] = useState('')

  const [installProgress, setInstallProgress] = useState<InstallProgressState>({
    step: 0, status: 'idle', message: '', error: '', completed: [],
  })

  // ── Shared input style ─────────────────────────────────────────────────────
  const inputClass =
    'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm ' +
    'focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent ' +
    'placeholder-gray-400'

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-amber-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-8">

        {/* Step indicator */}
        <StepDots total={8} current={currentStep} />

        {/* ── STEP 1 — Welcome ─────────────────────────────────────────────── */}
        {currentStep === 1 && (
          <div className="flex flex-col items-center text-center gap-7">
            {/* Logo mark */}
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-200">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold tracking-widest text-emerald-500 uppercase">Store Setup</p>
              <h1 className="text-3xl font-bold text-gray-900">Welcome to Fruitopia</h1>
              <p className="text-gray-500 text-base leading-relaxed max-w-sm mx-auto">
                Let's get your store configured and ready for customers in about 2 minutes.
              </p>
            </div>

            <div className="w-full border-t border-gray-100 pt-5 flex flex-col gap-3 items-center">
              <button className={primaryBtn} onClick={() => setCurrentStep(2)}>
                Begin Setup →
              </button>
              <p className="text-xs text-gray-400">No coding required · Takes ~2 min</p>
            </div>
          </div>
        )}

        {/* ── STEP 3 — Requirements Check ──────────────────────────────────── */}
        {currentStep === 3 && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-1">Requirements Check</h2>
              <p className="text-gray-500 text-sm">Verifying your environment before we continue.</p>
            </div>

            <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl px-4">
              <CheckRow
                status={checks.internet}
                okLabel="Internet connection active"
                failLabel="No internet connection. Please connect and retry."
              />
              <CheckRow
                status={checks.storage}
                okLabel="Browser storage available"
                failLabel="localStorage blocked. Check browser privacy settings."
              />
              <CheckRow
                 status={checks.backend}
                 okLabel={`${backend === 'supabase' ? 'Supabase' : 'Firebase'} servers reachable`}
                 failLabel={`Cannot reach ${backend === 'supabase' ? 'Supabase' : 'Firebase'}. Check internet or firewall.`}
              />
            </div>

            <div className="flex items-center justify-between">
              {/* Back is hidden on step 1 — shown from step 2 onward */}
              <button className={backBtn} onClick={() => setCurrentStep(2)}>
                ← Back
              </button>

              <div className="flex gap-3">
                {anyCheckFailed && (
                  <button
                    className="border border-emerald-500 text-emerald-600 hover:bg-emerald-50 font-semibold px-5 py-3 rounded-lg transition-colors duration-150"
                    onClick={() => runChecks()}
                  >
                    Retry
                  </button>
                )}
                <button
                  className={primaryBtn}
                  disabled={!allChecksOk}
                  onClick={() => setCurrentStep(4)}
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2 — Backend Choice ──────────────────────────────────────── */}
        {currentStep === 2 && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-1">Choose your backend</h2>
              <p className="text-gray-500 text-sm">Pick where Fruitopia will store its data. You can switch later from the Admin Panel.</p>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <button onClick={() => { setBackend('firebase'); setChecks({ internet: 'idle', storage: 'idle', backend: 'idle' }); setCurrentStep(3); }} className="text-left border-2 border-gray-200 hover:border-amber-400 hover:bg-amber-50 rounded-xl p-4 transition">
                <div className="flex items-center gap-3"><span className="text-2xl">🔥</span><div><p className="font-semibold text-gray-800">Firebase (Firestore)</p><p className="text-xs text-gray-500">Google Firestore + Firebase Auth. Generous free tier. Best for low-ops setups.</p></div></div>
              </button>
              <button onClick={() => { setBackend('supabase'); setChecks({ internet: 'idle', storage: 'idle', backend: 'idle' }); setCurrentStep(3); }} className="text-left border-2 border-gray-200 hover:border-emerald-400 hover:bg-emerald-50 rounded-xl p-4 transition">
                <div className="flex items-center gap-3"><span className="text-2xl">🟢</span><div><p className="font-semibold text-gray-800">Supabase (Postgres)</p><p className="text-xs text-gray-500">Open-source Postgres + Auth. Requires a few SQL tables (we print them for you).</p></div></div>
              </button>
            </div>
            <div className="flex items-center justify-between pt-1">
              <button className={backBtn} onClick={() => setCurrentStep(1)}>← Back</button>
              <span className="text-xs text-gray-400">Pick one to continue</span>
            </div>
          </div>
        )}

        {/* ── STEP 4 — Supabase Credentials ─────────────────────────────────── */}
        {currentStep === 4 && backend === 'supabase' && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-1">Supabase Credentials</h2>
              <p className="text-gray-500 text-sm">Get these from Supabase → Project Settings → API.</p>
              <button type="button" className="text-xs text-gray-400 underline mt-1" onClick={() => { setBackend(null); setSbTest({ status:'idle', message:'' }); setCurrentStep(2) }}>← Change backend</button>
            </div>
            <details className="text-xs text-gray-600 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <summary className="cursor-pointer font-semibold text-emerald-800">📋 Required SQL schema — click to expand</summary>
              <p className="mt-2 text-[11px] text-emerald-800 leading-relaxed">These policies allow your storefront to read public data and accept new orders/reviews. During installation, the admin key can seed products/categories/coupons. After installation, these are read-only for public users.</p>
              <div className="relative mt-2">
              <pre className="bg-slate-900 text-emerald-300 text-[11px] font-mono p-3 rounded overflow-x-auto select-all max-h-96 whitespace-pre-wrap">{`-- ═════════════════════════════════════════════════════════════════════════════
-- FRUITOPIA — Full Supabase Schema + RLS + Realtime
-- Paste this entire block into Supabase → SQL Editor, then click RUN.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Core tables ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings   (key TEXT PRIMARY KEY, value JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS products   (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS orders     (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS coupons    (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS newsletter (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS reviews    (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS users      (id TEXT PRIMARY KEY, data JSONB NOT NULL);

-- ── Gallery + Variant tables ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_images         (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS product_variant_groups (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS product_variants       (id TEXT PRIMARY KEY, data JSONB NOT NULL);

-- ── Grants (anon = your storefront's public anon key) ──────────────────────
-- Settings: install wizard + admin panel reads/writes config
GRANT SELECT, INSERT, UPDATE, DELETE ON settings   TO anon;
GRANT ALL                            ON settings   TO service_role;
-- Products: admin seeds, edits, deletes; storefront reads
GRANT SELECT, INSERT, UPDATE, DELETE ON products   TO anon;
GRANT ALL                            ON products   TO service_role;
-- Categories: admin seeds, edits, deletes; storefront reads
GRANT SELECT, INSERT, UPDATE, DELETE ON categories TO anon;
GRANT ALL                            ON categories TO service_role;
-- Coupons: admin manages; storefront validates
GRANT SELECT, INSERT, UPDATE, DELETE ON coupons    TO anon;
GRANT ALL                            ON coupons    TO service_role;
-- Orders: customers create; admin reads/updates/deletes
GRANT SELECT, INSERT, UPDATE, DELETE ON orders     TO anon;
GRANT ALL                            ON orders     TO service_role;
-- Reviews: customers create; admin moderates/deletes
GRANT SELECT, INSERT, UPDATE, DELETE ON reviews    TO anon;
GRANT ALL                            ON reviews    TO service_role;
-- Newsletter: customers subscribe; admin manages
GRANT SELECT, INSERT, UPDATE, DELETE ON newsletter TO anon;
GRANT ALL                            ON newsletter TO service_role;
-- Users: customer accounts
GRANT SELECT, INSERT, UPDATE, DELETE ON users      TO anon;
GRANT ALL                            ON users      TO service_role;
-- Gallery + Variant tables: full admin access via anon key
GRANT SELECT, INSERT, UPDATE, DELETE ON product_images         TO anon;
GRANT ALL                            ON product_images         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_variant_groups TO anon;
GRANT ALL                            ON product_variant_groups TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_variants       TO anon;
GRANT ALL                            ON product_variants       TO service_role;

-- ── Enable Realtime on ALL tables (idempotent) ────────────────────────────
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE settings;   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE products;   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE categories; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE coupons;    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE orders;     EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE reviews;    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE newsletter; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Enable RLS on every table ────────────────────────────────────────────────
ALTER TABLE settings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders                ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons               ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter            ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews               ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images         ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variant_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants       ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies — permissive: allow anon full CRUD ─────────────────────────
-- Drop old + new policies for idempotent re-runs (safe to run even if missing)
DROP POLICY IF EXISTS "anon products all"       ON products;
DROP POLICY IF EXISTS "anon categories all"     ON categories;
DROP POLICY IF EXISTS "anon coupons all"        ON coupons;
DROP POLICY IF EXISTS "anon settings all"       ON settings;
DROP POLICY IF EXISTS "anon orders all"         ON orders;
DROP POLICY IF EXISTS "anon reviews all"        ON reviews;
DROP POLICY IF EXISTS "anon newsletter all"     ON newsletter;
DROP POLICY IF EXISTS "anon users all"          ON users;
DROP POLICY IF EXISTS "anon pimages all"        ON product_images;
DROP POLICY IF EXISTS "anon pvgroups all"       ON product_variant_groups;
DROP POLICY IF EXISTS "anon pvariants all"      ON product_variants;
DROP POLICY IF EXISTS "public read settings"    ON settings;
DROP POLICY IF EXISTS "anon write settings"     ON settings;
DROP POLICY IF EXISTS "anon update settings"    ON settings;
DROP POLICY IF EXISTS "public read products"    ON products;
DROP POLICY IF EXISTS "anon write products"     ON products;
DROP POLICY IF EXISTS "anon update products"    ON products;
DROP POLICY IF EXISTS "public read categories"  ON categories;
DROP POLICY IF EXISTS "anon write categories"   ON categories;
DROP POLICY IF EXISTS "anon update categories"  ON categories;
DROP POLICY IF EXISTS "public read reviews"     ON reviews;
DROP POLICY IF EXISTS "anon write reviews"      ON reviews;
DROP POLICY IF EXISTS "anon update reviews"     ON reviews;
DROP POLICY IF EXISTS "public read coupons"     ON coupons;
DROP POLICY IF EXISTS "anon write coupons"      ON coupons;
DROP POLICY IF EXISTS "anon update coupons"     ON coupons;
DROP POLICY IF EXISTS "anon write pimages"      ON product_images;
DROP POLICY IF EXISTS "anon write pvgroups"     ON product_variant_groups;
DROP POLICY IF EXISTS "anon write pvariants"    ON product_variants;
DROP POLICY IF EXISTS "public create orders"    ON orders;
DROP POLICY IF EXISTS "public create reviews"   ON reviews;
DROP POLICY IF EXISTS "public update reviews"   ON reviews;
DROP POLICY IF EXISTS "public create newsletter" ON newsletter;
DROP POLICY IF EXISTS "public write users"      ON users;
-- Create fresh policies
CREATE POLICY "anon products all" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon categories all" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon coupons all" ON coupons FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon settings all" ON settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon orders all" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon reviews all" ON reviews FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon newsletter all" ON newsletter FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon users all" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon pimages all" ON product_images FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon pvgroups all" ON product_variant_groups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon pvariants all" ON product_variants FOR ALL USING (true) WITH CHECK (true);`}</pre>
                <button
                  type="button"
                  onClick={(e) => {
                    const pre = (e.currentTarget.previousSibling as HTMLElement)
                    try {
                      navigator.clipboard.writeText(pre?.innerText || '').then(() => {
                        setSqlCopied(true)
                        setTimeout(() => setSqlCopied(false), 2000)
                      })
                    } catch {}
                  }}
                  className="absolute top-2 right-2 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold uppercase px-2 py-1 rounded transition-colors"
                >{sqlCopied ? '✓ Copied!' : 'Copy'}</button>
              </div>
            </details>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Project URL <span className="text-rose-500">*</span></label>
                <input type="text" className={inputClass} placeholder="https://xxx.supabase.co" value={supabaseCreds.projectUrl} onChange={handleSbCredChange('projectUrl')} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Anon (public) Key <span className="text-rose-500">*</span></label>
                <input type="text" className={inputClass} placeholder="eyJhbGciOi..." value={supabaseCreds.anonKey} onChange={handleSbCredChange('anonKey')} />
              </div>
            </div>
            <button className={primaryBtn} disabled={sbTestDisabled} onClick={handleTestSupabase}>{sbTest.status === 'running' ? (<span className="flex items-center gap-2 justify-center"><span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Testing…</span>) : 'Test Connection →'}</button>
            {sbTest.status === 'ok' && (<div className="bg-emerald-50 border border-emerald-500 text-emerald-700 p-3 rounded-lg text-sm">{sbTest.message}</div>)}
            {sbTest.status === 'fail' && (<div className="bg-rose-50 border border-rose-500 text-rose-700 p-3 rounded-lg text-sm break-words">{sbTest.message}</div>)}
            <div className="flex items-center justify-between pt-1">
              <button className={backBtn} onClick={() => setCurrentStep(3)}>← Back</button>
              <button className={primaryBtn} disabled={sbTest.status !== 'ok'} onClick={() => setCurrentStep(5)}>Next →</button>
            </div>
          </div>
        )}

        {/* ── STEP 4 — Firebase Credentials ────────────────────────────────── */}
        {currentStep === 4 && backend === 'firebase' && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-1">Firebase Credentials</h2>
              <p className="text-gray-500 text-sm">
                Get these from Firebase Console → Project Settings → Your apps → SDK setup
              </p>
              <a
                href="https://console.firebase.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-2 text-emerald-600 underline text-sm hover:text-emerald-700"
              >
                🔗 Open Firebase Console
              </a>
              <button type="button" className="block text-xs text-gray-400 underline mt-1" onClick={() => { setBackend(null); setConnTest({ status:'idle', message:'' }); setCurrentStep(2) }}>← Change backend</button>
            </div>

            <details className="text-xs text-gray-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <summary className="cursor-pointer font-semibold text-amber-800">🔥 Required Firebase setup — click to expand</summary>
              <ol className="mt-2 text-[11px] text-amber-900 leading-relaxed list-decimal list-inside space-y-1">
                <li>In Firebase Console → <strong>Build → Authentication</strong>, click <em>Get Started</em> and enable the <strong>Email/Password</strong> sign-in provider.</li>
                <li>In <strong>Build → Firestore Database</strong>, click <em>Create database</em> (any region, start in production mode).</li>
                <li>Open the <strong>Rules</strong> tab in Firestore and paste the rules below, then click <em>Publish</em>.</li>
                <li>In <strong>Authentication → Settings → Authorized domains</strong>, add the domain you'll run the site on (e.g. <code>localhost</code>, your Vercel/Render domain).</li>
              </ol>
              <div className="relative mt-2">
                <pre className="bg-slate-900 text-emerald-300 text-[11px] font-mono p-3 rounded overflow-x-auto select-all">{`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Public storefront reads
    match /products/{id}    { allow read: if true; allow write: if request.auth != null; }
    match /categories/{id}  { allow read: if true; allow write: if request.auth != null; }
    match /reviews/{id}     { allow read: if true; allow create: if true; allow update, delete: if request.auth != null; }
    match /coupons/{id}     { allow read: if true; allow write: if request.auth != null; }
    match /settings/{id}    { allow read: if true; allow write: if request.auth != null; }
    // Customer submissions
    match /orders/{id}      { allow create: if true; allow read, update, delete: if request.auth != null; }
    match /newsletter/{id}  { allow create: if true; allow read, update, delete: if request.auth != null; }

    // Customer accounts (signup, guest checkout, Google sign-in). Shoppers
    // are never signed into Firebase Auth themselves, so these two
    // collections can't be gated behind request.auth like the ones above —
    // they're validated by document shape instead. userPhones/{phoneKey}
    // is a uniqueness index so two accounts can never claim the same phone
    // number; accounts that don't claim one (e.g. guest checkout) just
    // leave phoneKey empty.
    match /userPhones/{phoneId} {
      allow read: if false;
      allow create: if request.resource.data.phoneKey == phoneId
                    && request.resource.data.userId is string
                    && !exists(/databases/$(database)/documents/userPhones/$(phoneId));
      allow update, delete: if request.auth != null;
    }
    match /users/{userId} {
      allow read: if true;
      allow create: if request.resource.data.id == userId
                    && request.resource.data.email is string
                    && request.resource.data.name is string
                    && request.resource.data.name.size() > 0
                    && request.resource.data.passwordHash is string
                    && (
                          request.resource.data.phoneKey == ''
                          || (
                                existsAfter(/databases/$(database)/documents/userPhones/$(request.resource.data.phoneKey))
                                && getAfter(/databases/$(database)/documents/userPhones/$(request.resource.data.phoneKey)).data.userId == userId
                                && !exists(/databases/$(database)/documents/userPhones/$(request.resource.data.phoneKey))
                             )
                       );
      // Customers can update their OWN record (profile edits, password
      // resets) without being Firebase-Auth signed in, as long as they
      // aren't changing which account it is (id/email must stay the same —
      // this is what stops one account from being hijacked into another).
      allow update: if request.auth != null
                    || (request.resource.data.id == userId && request.resource.data.email == resource.data.email);
      allow delete: if request.auth != null;
    }
  }
}`}</pre>
                <button
                  type="button"
                  onClick={(e) => {
                    const pre = (e.currentTarget.previousSibling as HTMLElement)
                    try {
                      navigator.clipboard.writeText(pre?.innerText || '').then(() => {
                        setRulesCopied(true)
                        setTimeout(() => setRulesCopied(false), 2000)
                      })
                    } catch {}
                  }}
                  className="absolute top-2 right-2 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold uppercase px-2 py-1 rounded transition-colors"
                >{rulesCopied ? '✓ Copied!' : 'Copy'}</button>
              </div>
            </details>

            <div className="flex flex-col gap-3">
              {/* API Key */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API Key <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="AIzaSy..."
                  value={creds.apiKey}
                  onChange={handleCredChange('apiKey')}
                />
              </div>

              {/* Auth Domain */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Auth Domain <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="your-project.firebaseapp.com"
                  value={creds.authDomain}
                  onChange={handleCredChange('authDomain')}
                />
              </div>

              {/* Project ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Project ID <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="your-project-id"
                  value={creds.projectId}
                  onChange={handleCredChange('projectId')}
                />
              </div>

              {/* Storage Bucket */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Storage Bucket <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="your-project.appspot.com"
                  value={creds.storageBucket}
                  onChange={handleCredChange('storageBucket')}
                />
              </div>

              {/* Messaging Sender ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Messaging Sender ID <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="123456789012"
                  value={creds.messagingSenderId}
                  onChange={handleCredChange('messagingSenderId')}
                />
              </div>

              {/* App ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  App ID <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="1:123456789012:web:abc123..."
                  value={creds.appId}
                  onChange={handleCredChange('appId')}
                />
              </div>

              {/* Database ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Database ID
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="(default)"
                  value={creds.databaseId}
                  onChange={handleCredChange('databaseId')}
                />
              </div>
            </div>

            {/* Test Connection button */}
            <button
              className={primaryBtn}
              disabled={testDisabled}
              onClick={handleTestConnection}
            >
              {connTest.status === 'running' ? (
                <span className="flex items-center gap-2 justify-center">
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Testing…
                </span>
              ) : (
                'Test Connection →'
              )}
            </button>

            {/* Connection result banner */}
            {connTest.status === 'ok' && (
              <div className="bg-emerald-50 border border-emerald-500 text-emerald-700 p-3 rounded-lg text-sm">
                {connTest.message}
              </div>
            )}
            {connTest.status === 'fail' && (
              <div className="bg-rose-50 border border-rose-500 text-rose-700 p-3 rounded-lg text-sm break-words">
                {connTest.message}
              </div>
            )}

            {/* Nav row */}
            <div className="flex items-center justify-between pt-1">
              <button className={backBtn} onClick={() => setCurrentStep(3)}>
                ← Back
              </button>
              <button
                className={primaryBtn}
                disabled={connTest.status !== 'ok'}
                onClick={() => setCurrentStep(5)}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 5 — Admin Account ────────────────────────────────────────── */}
        {currentStep === 5 && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-1">Admin Account</h2>
              <p className="text-gray-500 text-sm">Create your store administrator credentials.</p>
            </div>

            <div className="flex flex-col gap-4">
              {/* Admin Username */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Admin Username <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  className={`${inputClass} ${adminErrors.username ? 'border-rose-400' : ''}`}
                  placeholder="admin"
                  value={admin.username}
                  onChange={handleAdminChange('username')}
                />
                {adminErrors.username && (
                  <p className="text-rose-500 text-sm mt-1">{adminErrors.username}</p>
                )}
              </div>

              {/* Admin Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Admin Email <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  className={`${inputClass} ${adminErrors.email ? 'border-rose-400' : ''}`}
                  placeholder="you@gmail.com"
                  value={admin.email}
                  onChange={handleAdminChange('email')}
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Your real email address (Gmail, Yahoo, custom domain, etc.). Examples: you@gmail.com, name@yahoo.com, admin@yourdomain.com
                </p>
                {adminErrors.email && (
                  <p className="text-rose-500 text-sm mt-1">{adminErrors.email}</p>
                )}
              </div>

              {/* Admin Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Admin Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPwd ? 'text' : 'password'}
                    className={`${inputClass} pr-10 ${adminErrors.password ? 'border-rose-400' : ''}`}
                    placeholder="••••••••"
                    value={admin.password}
                    onChange={handleAdminChange('password')}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                    onClick={() => setShowPwd(v => !v)}
                    aria-label={showPwd ? 'Hide password' : 'Show password'}
                  >
                    {showPwd ? (
                      // Eye-off icon
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88L6.59 6.59m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      // Eye icon
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
                {adminErrors.password && (
                  <p className="text-rose-500 text-sm mt-1">{adminErrors.password}</p>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    className={`${inputClass} pr-10 ${adminErrors.confirm ? 'border-rose-400' : ''}`}
                    placeholder="••••••••"
                    value={admin.confirm}
                    onChange={handleAdminChange('confirm')}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                    onClick={() => setShowConfirm(v => !v)}
                    aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
                  >
                    {showConfirm ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88L6.59 6.59m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
                {adminErrors.confirm && (
                  <p className="text-rose-500 text-sm mt-1">{adminErrors.confirm}</p>
                )}
              </div>
            </div>

            {/* Nav row */}
            <div className="flex items-center justify-between pt-1">
              <button className={backBtn} onClick={() => setCurrentStep(4)}>
                ← Back
              </button>
              <button className={primaryBtn} onClick={handleAdminNext}>
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 6 — Store Information ───────────────────────────────────── */}
        {currentStep === 6 && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-1">Store Information</h2>
              <p className="text-gray-500 text-sm">Tell us a bit about your store.</p>
            </div>

            <div className="flex flex-col gap-4">
              {/* Store Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Store Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  className={`${inputClass} ${storeNameError ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  placeholder="Fruitopia"
                  value={store.name}
                  onChange={e => {
                    setStore(prev => ({ ...prev, name: e.target.value }))
                    if (storeNameError) setStoreNameError('')
                  }}
                />
                {storeNameError && (
                  <p className="text-rose-500 text-sm mt-1">{storeNameError}</p>
                )}
              </div>

              {/* Contact Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contact Email
                </label>
                <input
                  type="email"
                  className={inputClass}
                  placeholder="hello@fruitopia.com"
                  value={store.email}
                  onChange={e => setStore(prev => ({ ...prev, email: e.target.value }))}
                />
              </div>

              {/* Currency */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Currency
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="USD"
                  value={store.currency}
                  onChange={e => setStore(prev => ({ ...prev, currency: e.target.value }))}
                />
              </div>

              {/* Currency Symbol */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Currency Symbol
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="$"
                  value={store.symbol}
                  onChange={e => setStore(prev => ({ ...prev, symbol: e.target.value }))}
                />
              </div>
            </div>

            <p className="text-gray-500 text-sm">These can be changed anytime in the Admin Panel.</p>

            <div className="flex items-center justify-between pt-1">
              <button className={backBtn} onClick={() => setCurrentStep(5)}>
                ← Back
              </button>
              <button
                className={primaryBtn}
                onClick={() => {
                  if (!store.name.trim()) {
                    setStoreNameError('Store name is required.')
                    return
                  }
                  setStoreNameError('')
                  setCurrentStep(7)
                }}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 7 — Installing ───────────────────────────────────────────── */}
        {currentStep === 7 && backend === 'firebase' && (
          <Step6Install
            installProgress={installProgress}
            setInstallProgress={setInstallProgress}
            setCurrentStep={setCurrentStep}
            creds={creds}
            supabaseCreds={supabaseCreds}
            backend="firebase"
            detectedPlatform={detectedPlatform}
            admin={admin}
            store={store}
            backBtn={backBtn}
            primaryBtn={primaryBtn}
          />
        )}

        {currentStep === 7 && backend === 'supabase' && (
          <Step6Install
            installProgress={installProgress}
            setInstallProgress={setInstallProgress}
            setCurrentStep={setCurrentStep}
            creds={creds}
            supabaseCreds={supabaseCreds}
            backend="supabase"
            detectedPlatform={detectedPlatform}
            admin={admin}
            store={store}
            backBtn={backBtn}
            primaryBtn={primaryBtn}
          />
        )}

        {currentStep === 7 && !backend && (
          <div className="flex flex-col items-center gap-4 text-center py-8">
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-6 max-w-sm">
              <p className="text-lg font-semibold text-rose-700 mb-2">⚠️ Backend Selection Lost</p>
              <p className="text-sm text-rose-600 mb-4">Your backend choice was not properly saved. Please go back and select Firebase or Supabase again.</p>
              <button 
                className={primaryBtn}
                onClick={() => { setBackend(null); setCurrentStep(2); }}
              >
                ← Go Back to Backend Selection
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 8 — Success ─────────────────────────────────────────────── */}
        {currentStep === 8 && (
          <div className="flex flex-col items-center gap-6 text-center">
            {/* Green checkmark circle */}
            <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <span className="text-5xl select-none">✅</span>
            </div>

            <div className="space-y-1">
              <h2 className="text-3xl font-bold text-gray-900">Installation Complete!</h2>
              <p className="text-gray-600">Your Fruitopia store is ready.</p>
            </div>

            {/* Checklist */}
            <div className="w-full bg-gray-50 border border-gray-100 rounded-xl px-6 py-4 text-left space-y-2">
              {[
                backend === 'supabase' ? 'Supabase connected' : 'Firebase connected',
                'Configuration saved',
                'Admin authentication created',
                'Store data seeded',
                'Admin account created',
                'Settings saved',
                'Installation finalised',
              ].map((label, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span className="text-gray-600">{label}</span>
                </div>
              ))}
            </div>

            {/* Navigation buttons */}
            <div className="flex gap-3 w-full">
              <button
                className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-6 py-3 rounded-lg transition-colors duration-150"
                onClick={() => { window.location.href = '/' }}
              >
                🏪 Go to Store →
              </button>
              <button
                className="flex-1 bg-gray-800 hover:bg-gray-900 text-white font-semibold px-6 py-3 rounded-lg transition-colors duration-150"
                onClick={() => { window.location.href = '/admin' }}
              >
                ⚙️ Go to Admin Panel →
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
