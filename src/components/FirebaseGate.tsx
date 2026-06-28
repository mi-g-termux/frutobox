/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  BackendGate (formerly FirebaseGate)
 *
 *  Boot-level gate that blocks the app until the chosen backend (Firebase OR
 *  Supabase) is confirmed ready, or routes the user to the Install Wizard.
 *
 *  States:
 *    'checking'  →  Loading spinner
 *    'install'   →  <InstallWizard />  (no backend configured at all)
 *    'error'     →  Friendly error card with Retry + Run Wizard buttons
 *    'ready'     →  {children}
 *
 *  The component subscribes to BOTH ready-state listeners (firebase + supabase)
 *  so it reacts to whichever engine the admin selected.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useState } from 'react';
import {
  getIsFirebaseConfigured,
  onFirebaseReadyChange,
  firebaseBootPromise,
} from '../firebase';
import {
  getIsSupabaseConfigured,
  onSupabaseReadyChange,
  getSupabaseRuntimeConfig,
} from '../supabase';
import InstallWizard from './InstallWizard';

type GateState = 'checking' | 'install' | 'error' | 'ready';

interface BackendGateProps {
  children: React.ReactNode;
}

export const FirebaseGate: React.FC<BackendGateProps> = ({ children }) => {
  const [gateState, setGateState] = useState<GateState>('checking');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function evaluate() {
      setGateState('checking');
      setErrorMessage('');

      // Wait for Firebase boot attempt to settle (it may end in "not configured"
      // — that's fine, we just need it to have tried).
      try {
        await firebaseBootPromise;
      } catch (bootErr: any) {
        if (cancelled) return;
        setErrorMessage(bootErr?.message || 'Backend SDK failed to initialise.');
        setGateState('error');
        return;
      }

      if (cancelled) return;

      const firebaseReady = getIsFirebaseConfigured();
      const supabaseReady = getIsSupabaseConfigured();
      const supabaseHasConfig = !!getSupabaseRuntimeConfig();

      if (firebaseReady || supabaseReady) {
        setGateState('ready');
        return;
      }

      // Supabase has config but the client isn't ready yet (still booting
      // from module-level boot promise). Keep checking — the ready listener
      // below will flip us to ready when it lands.
      if (supabaseHasConfig) {
        setGateState('checking');
        return;
      }

      // Nothing configured anywhere → straight to the install wizard.
      setGateState('install');
    }

    evaluate();

    const unsubFb = onFirebaseReadyChange((ready) => {
      if (ready) { setGateState('ready'); setErrorMessage(''); return; }
      // Firebase became unconfigured — re-evaluate (supabase may be live)
      evaluate();
    });
    const unsubSb = onSupabaseReadyChange((ready) => {
      if (ready) { setGateState('ready'); setErrorMessage(''); return; }
      evaluate();
    });

    return () => {
      cancelled = true;
      unsubFb();
      unsubSb();
    };
  }, []);

  if (gateState === 'checking') {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 border-[3px] border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-400 font-semibold tracking-wide">Initialising…</p>
      </div>
    );
  }

  if (gateState === 'install') {
    return <InstallWizard />;
  }

  if (gateState === 'error') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl border border-slate-200 text-center space-y-5">
          <div className="w-16 h-16 rounded-full bg-rose-100 flex items-center justify-center mx-auto">
            <span className="text-3xl">⚠️</span>
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">Backend Connection Error</h2>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              The app couldn't connect to its database. Check your configuration or run the setup wizard.
            </p>
          </div>
          {errorMessage && (
            <pre className="bg-rose-50 border border-rose-200 text-rose-700 text-xs text-left p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
              {errorMessage}
            </pre>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => { setGateState('checking'); setErrorMessage(''); setTimeout(() => {
                if (getIsFirebaseConfigured() || getIsSupabaseConfigured()) setGateState('ready');
                else setGateState('install');
              }, 500); }}
              className="flex-1 cursor-pointer bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors"
            >Retry</button>
            <button
              onClick={() => setGateState('install')}
              className="flex-1 cursor-pointer bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors"
            >Run Setup Wizard</button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default FirebaseGate;
