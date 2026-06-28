/**
 * Compact country dial-code picker.
 *
 * Selected pill shows only the ISO short code + dial (e.g. "BD +880") so it
 * never wraps or overflows on narrow checkout layouts. The open dropdown
 * lists the FULL country name plus its dial code for easy scanning.
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { COUNTRY_PHONE_RULES, findRule, type CountryPhoneRule } from '../lib/phoneValidation';

interface Props {
  value: string;                    // current dial code, e.g. "+880"
  onChange: (dial: string) => void;
  className?: string;
}

export default function CountryDialPicker({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const current = findRule(value);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered: CountryPhoneRule[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRY_PHONE_RULES;
    return COUNTRY_PHONE_RULES.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.iso.toLowerCase().includes(q) ||
      c.dial.includes(q),
    );
  }, [query]);

  return (
    <div ref={rootRef} className={`relative ${className || ''}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${current.name} (${current.dial})`}
        className="flex items-center gap-1.5 px-2.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white cursor-pointer min-w-[96px] whitespace-nowrap"
      >
        <span className="font-bold text-slate-700">{current.iso || '??'}</span>
        <span className="text-slate-500">{current.dial}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-auto" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-50 mt-1 left-0 w-72 max-w-[80vw] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden"
        >
          <div className="p-2 border-b border-slate-100 sticky top-0 bg-white">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search country, code, or dial…"
                className="w-full pl-8 pr-2 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-xs text-slate-500 text-center">No matches</li>
            )}
            {filtered.map(c => {
              const active = c.dial === value;
              return (
                <li key={c.dial + c.iso}>
                  <button
                    type="button"
                    onClick={() => { onChange(c.dial); setOpen(false); setQuery(''); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-emerald-50 ${active ? 'bg-emerald-50 font-semibold' : ''}`}
                  >
                    <span className="inline-block w-7 text-[10px] font-bold uppercase tracking-wide text-slate-500 bg-slate-100 rounded px-1 py-0.5 text-center">{c.iso}</span>
                    <span className="flex-1 text-slate-700 truncate">{c.name}</span>
                    <span className="text-slate-500 text-xs tabular-nums">{c.dial}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
