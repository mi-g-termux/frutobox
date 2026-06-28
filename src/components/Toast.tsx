/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  title: string;
  body: string;
  message: string;
  type: ToastType;
  visible: boolean;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Split a single "message" string into a title + body line so the toast looks
// like a modern card (title on top, supporting copy below). If the caller
// already passed two sentences separated by ":" or ".", we keep them split.
const splitMessage = (raw: string, type: ToastType): { title: string; body: string } => {
  const defaults: Record<ToastType, string> = {
    success: 'Success',
    error: 'Something went wrong',
    info: 'Heads up',
  };
  const msg = (raw || '').trim();
  if (!msg) return { title: defaults[type], body: '' };
  // Prefer "Title: body" split, then "Title. body" if first sentence is short.
  if (msg.includes(':')) {
    const i = msg.indexOf(':');
    const title = msg.slice(0, i).trim();
    const body = msg.slice(i + 1).trim();
    if (title.length > 0 && title.length <= 40 && body.length > 0) return { title, body };
  }
  const periodIdx = msg.indexOf('. ');
  if (periodIdx > 0 && periodIdx <= 38) {
    return { title: msg.slice(0, periodIdx).trim(), body: msg.slice(periodIdx + 1).trim() };
  }
  // Short message → use as body with a default title
  return { title: defaults[type], body: msg };
};

const ToastItemView = ({ t, onRemove }: { t: ToastItem; onRemove: (id: string) => void }) => {
  const ring =
    t.type === 'success' ? 'ring-emerald-100' : t.type === 'error' ? 'ring-rose-100' : 'ring-sky-100';
  const iconBg =
    t.type === 'success' ? 'bg-emerald-500' : t.type === 'error' ? 'bg-rose-500' : 'bg-sky-500';
  const Icon =
    t.type === 'success' ? CheckCircle2 : t.type === 'error' ? AlertTriangle : Info;

  return (
    <div
      style={{
        transition: 'opacity .25s ease, transform .25s cubic-bezier(.2,.8,.2,1)',
        opacity: t.visible ? 1 : 0,
        transform: t.visible ? 'translateY(0) scale(1)' : 'translateY(8px) scale(.97)',
      }}
      className={`pointer-events-auto flex items-start gap-3 pl-3 pr-2 py-3 rounded-2xl bg-white shadow-[0_10px_30px_-12px_rgba(15,23,42,0.18)] ring-1 ${ring} border border-slate-100 min-w-[280px] max-w-sm`}
      role={t.type === 'error' ? 'alert' : 'status'}
    >
      <div className={`flex-shrink-0 w-9 h-9 rounded-full ${iconBg} flex items-center justify-center shadow-sm`}>
        <Icon className="w-5 h-5 text-white" strokeWidth={2.5} />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <p className="text-[13px] font-semibold text-slate-900 leading-tight tracking-tight">
          {t.title}
        </p>
        {t.body && (
          <p className="text-[12px] text-slate-500 leading-snug mt-0.5">
            {t.body}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onRemove(t.id)}
        aria-label="Dismiss notification"
        className="flex-shrink-0 p-1.5 rounded-full text-slate-300 hover:text-slate-600 hover:bg-slate-50 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    const { title, body } = splitMessage(message, type);
    setToasts((prev) => [...prev, { id, title, body, message, type, visible: false }]);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setToasts((prev) => prev.map(t => t.id === id ? { ...t, visible: true } : t));
      });
    });
    setTimeout(() => {
      setToasts((prev) => prev.map(t => t.id === id ? { ...t, visible: false } : t));
    }, 3700);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const success = useCallback((msg: string) => toast(msg, 'success'), [toast]);
  const error = useCallback((msg: string) => toast(msg, 'error'), [toast]);
  const info = useCallback((msg: string) => toast(msg, 'info'), [toast]);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.map(t => t.id === id ? { ...t, visible: false } : t));
    setTimeout(() => setToasts((prev) => prev.filter(t => t.id !== id)), 250);
  };

  return (
    <ToastContext.Provider value={{ toast, success, error, info }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[200] flex flex-col-reverse gap-3 max-w-sm w-full font-sans pointer-events-none">
        {toasts.map((t) => (
          <React.Fragment key={t.id}><ToastItemView t={t} onRemove={removeToast} /></React.Fragment>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside a ToastProvider context.');
  }
  return context;
};
