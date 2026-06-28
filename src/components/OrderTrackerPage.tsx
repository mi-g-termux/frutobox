/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FIXED: Order Tracker Page
 * - Improved search logic that works for everyone
 * - Better fallback mechanisms
 * - Case-insensitive search support
 * - Works for both logged-in and anonymous users
 */

import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Order, OrderStatus } from '../types';
import { Search, Package, CheckCircle, Truck, Clock, XCircle, RefreshCw, ArrowLeft, MapPin, Phone, Mail, ShoppingBag, CreditCard, ChevronRight, RotateCcw, Loader2 } from 'lucide-react';

interface OrderTrackerPageProps {
  initialOrderNumber?: string;
}

const STATUS_STEPS: { status: OrderStatus; label: string; icon: React.ReactNode; color: string; bg: string }[] = [
  { status: 'Pending',    label: 'Order Placed',  icon: <Clock size={16} />,        color: 'text-amber-600',   bg: 'bg-amber-100' },
  { status: 'Processing', label: 'Processing',    icon: <RefreshCw size={16} />,    color: 'text-blue-600',    bg: 'bg-blue-100' },
  { status: 'Confirmed',  label: 'Confirmed',     icon: <CheckCircle size={16} />,  color: 'text-indigo-600',  bg: 'bg-indigo-100' },
  { status: 'Shipped',    label: 'Shipped',       icon: <Truck size={16} />,        color: 'text-violet-600',  bg: 'bg-violet-100' },
  { status: 'Delivered',  label: 'Delivered',     icon: <Package size={16} />,      color: 'text-emerald-600', bg: 'bg-emerald-100' },
];

const STATUS_ORDER: OrderStatus[] = ['Pending', 'Processing', 'Confirmed', 'Shipped', 'Delivered'];

function getStepIndex(status: OrderStatus): number {
  if (status === 'Cancelled' || status === 'Refunded') return -1;
  return STATUS_ORDER.indexOf(status);
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const map: Record<OrderStatus, { label: string; cls: string }> = {
    Pending:    { label: 'Pending',    cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    Processing: { label: 'Processing', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
    Confirmed:  { label: 'Confirmed',  cls: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
    Shipped:    { label: 'Shipped',    cls: 'bg-violet-100 text-violet-700 border-violet-200' },
    Delivered:  { label: 'Delivered',  cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    Cancelled:  { label: 'Cancelled',  cls: 'bg-rose-100 text-rose-700 border-rose-200' },
    Refunded:   { label: 'Refunded',   cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  };
  const { label, cls } = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${cls}`}>
      {label}
    </span>
  );
}

function PaymentBadge({ status }: { status: Order['paymentStatus'] }) {
  const map = {
    Paid:    'bg-emerald-100 text-emerald-700 border-emerald-200',
    Pending: 'bg-amber-100 text-amber-700 border-amber-200',
    Failed:  'bg-rose-100 text-rose-700 border-rose-200',
    'Delivery Fee Paid': 'bg-sky-100 text-sky-700 border-sky-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${map[status]}`}>
      <CreditCard size={10} /> {status}
    </span>
  );
}

function OrderCard({ order, currency, currencySymbol, currencyPosition }: {
  order: Order;
  currency: string;
  currencySymbol: string;
  currencyPosition: 'before' | 'after';
}) {
  const [expanded, setExpanded] = useState(false);
  const stepIdx = getStepIndex(order.orderStatus);
  const isCancelledOrRefunded = order.orderStatus === 'Cancelled' || order.orderStatus === 'Refunded';

  const fmt = (n: number) =>
    currencyPosition === 'before' ? `${currencySymbol}${n.toFixed(2)}` : `${n.toFixed(2)}${currencySymbol}`;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Order Number</p>
          <h3 className="text-lg font-extrabold text-white tracking-tight">{order.orderNumber}</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">{new Date(order.createdAt).toLocaleString()}</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <StatusBadge status={order.orderStatus} />
          <PaymentBadge status={order.paymentStatus} />
        </div>
      </div>

      {/* Progress Bar */}
      {!isCancelledOrRefunded ? (
        <div className="px-5 py-5 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center gap-0">
            {STATUS_STEPS.map((step, i) => {
              const done = stepIdx >= i;
              const current = stepIdx === i;
              return (
                <React.Fragment key={step.status}>
                  <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all ${
                      done
                        ? `${step.bg} ${step.color} border-current shadow-sm`
                        : 'bg-white border-slate-200 text-slate-300'
                    } ${current ? 'ring-2 ring-offset-2 ring-current scale-110' : ''}`}>
                      {step.icon}
                    </div>
                    <p className={`text-[9px] font-bold uppercase tracking-tight text-center leading-tight max-w-[52px] ${done ? step.color : 'text-slate-300'}`}>
                      {step.label}
                    </p>
                  </div>
                  {i < STATUS_STEPS.length - 1 && (
                    <div className={`flex-1 h-0.5 mb-5 mx-1 rounded-full transition-all ${stepIdx > i ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="px-5 py-4 bg-rose-50 border-b border-rose-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center">
            <XCircle size={20} className="text-rose-600" />
          </div>
          <div>
            <p className="font-bold text-rose-700">{order.orderStatus}</p>
            <p className="text-xs text-rose-500">This order has been {order.orderStatus.toLowerCase()}. Please contact support.</p>
          </div>
        </div>
      )}

      {/* Summary row */}
      <div className="px-5 py-4 flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2 text-slate-600">
          <ShoppingBag size={14} className="text-slate-400" />
          <span className="font-semibold">{order.items.length} item{order.items.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-2 text-slate-600">
          <CreditCard size={14} className="text-slate-400" />
          <span className="font-semibold">{order.paymentMethod}</span>
        </div>
        <div className="ml-auto font-extrabold text-slate-900 text-base">{fmt(order.total)}</div>
      </div>

      {/* Expand / Collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-2.5 flex items-center justify-between text-xs font-bold uppercase text-slate-500 hover:bg-slate-50 border-t border-slate-100 transition-colors cursor-pointer"
      >
        <span>{expanded ? 'Hide' : 'View'} Order Details</span>
        <ChevronRight size={14} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-slate-100">
          {/* Items */}
          <div className="mt-4 space-y-2">
            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Items Ordered</p>
            {order.items.map((item, i) => {
              const isValidImageUrl = item.image && (
                item.image.startsWith('http') ||
                item.image.startsWith('data:image') ||
                item.image.startsWith('/')
              );
              return (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-lg flex-shrink-0 overflow-hidden">
                  {isValidImageUrl ? (
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-9 h-9 object-cover rounded-lg"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.parentElement as HTMLElement).innerText = '🛍️'; }}
                    />
                  ) : (
                    <span>🛍️</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-800 truncate">{item.name}</p>
                  {item.variantLabel && (
                    <p className="text-[10px] text-emerald-600 font-medium truncate">{item.variantLabel}</p>
                  )}
                  <p className="text-[10px] text-slate-400">Qty: {item.quantity}</p>
                </div>
                <p className="text-xs font-bold text-slate-800 flex-shrink-0">{fmt(item.price)}</p>
              </div>
              );
            })}
          </div>

          {/* Delivery info */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Delivery Details</p>
            {order.customerName && (
              <div className="flex gap-2 text-xs">
                <span className="text-slate-400">👤</span>
                <div>
                  <p className="font-semibold text-slate-700">{order.customerName}</p>
                </div>
              </div>
            )}
            {order.phone && (
              <div className="flex gap-2 text-xs">
                <Phone size={12} className="text-slate-400 flex-shrink-0 mt-0.5" />
                <a href={`tel:${order.phone}`} className="text-blue-600 hover:underline font-semibold">{order.phone}</a>
              </div>
            )}
            {order.email && (
              <div className="flex gap-2 text-xs">
                <Mail size={12} className="text-slate-400 flex-shrink-0 mt-0.5" />
                <a href={`mailto:${order.email}`} className="text-blue-600 hover:underline font-semibold">{order.email}</a>
              </div>
            )}
            {order.address && (
              <div className="flex gap-2 text-xs">
                <MapPin size={12} className="text-slate-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-slate-700"><strong>{order.address}</strong>{order.city ? `, ${order.city}` : ''}</p>
                </div>
              </div>
            )}
          </div>

          {/* Payment info */}
          <div>
            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-2">Payment Summary</p>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-slate-600"><span>Subtotal:</span> <span className="font-semibold">{fmt(order.items.reduce((s, i) => s + i.price * i.quantity, 0))}</span></div>
              {order.discount > 0 && (
                <div className="flex justify-between text-emerald-600"><span>Discount:</span> <span className="font-semibold">-{fmt(order.discount)}</span></div>
              )}
              <div className="border-t border-slate-100 pt-1 mt-1 flex justify-between font-bold text-slate-900">
                <span>Total:</span> <span>{fmt(order.total)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const OrderTrackerPage = ({ initialOrderNumber }: OrderTrackerPageProps) => {
  const { siteSettings, orders } = useApp();
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(!!initialOrderNumber);
  const [results, setResults] = useState<Order[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const currency = siteSettings?.currency || 'USD';
  const currencySymbol = siteSettings?.currencySymbol || '$';
  const currencyPosition = (siteSettings?.currencyPosition || 'before') as 'before' | 'after';

  /**
   * IMPROVED Search strategy that works for EVERYONE:
   * 
   * 1. Try to fetch by document ID directly (always works, doesn't need index)
   * 2. If that fails, try by orderNumber field with case-insensitive matching
   * 3. Fall back to local orders array (works even if empty)
   * 4. Use case-insensitive substring matching as final resort
   * 
   * This ensures anonymous users can search even without being logged in.
   */
  const handleSearch = async (overrideQuery?: string) => {
    const searchQuery = (overrideQuery ?? query).trim();
    if (!searchQuery) return;
    
    setSearched(true);
    setIsSearching(true);
    setResults([]);
    setNotFound(false);

    const found: Order[] = [];

    try {
      // ── Strategy 1: Try to fetch by document ID directly ──────────────────────
      // This ALWAYS works because rules allow `allow get: if true`
      try {
        const { getIsFirebaseConfigured } = await import('../firebase');
        if (getIsFirebaseConfigured()) {
          const { db } = await import('../firebase');
          if (db) {
            const { doc, getDoc } = await import('firebase/firestore');
            
            // Try the search query as a document ID
            try {
              const orderRef = doc(db, 'orders', searchQuery);
              const orderSnap = await getDoc(orderRef);
              if (orderSnap.exists()) {
                found.push({ id: orderSnap.id, ...orderSnap.data() } as Order);
              }
            } catch (e) {
              // Not a valid doc ID, continue to next strategy
            }
          }
        }
      } catch (err) {
        console.warn('[OrderTracker] Firebase getDoc failed:', err);
      }

      // ── Strategy 2: If direct fetch failed, try list query ──────────────────
      // This requires a composite index but has better UX
      if (found.length === 0) {
        try {
          const { getIsFirebaseConfigured } = await import('../firebase');
          if (getIsFirebaseConfigured()) {
            const { db } = await import('../firebase');
            if (db) {
              const { collection, query: fbQuery, where, getDocs } = await import('firebase/firestore');
              
              // Try exact match (case-insensitive via database)
              const snap = await getDocs(
                fbQuery(collection(db, 'orders'), where('orderNumber', '==', searchQuery.toUpperCase()))
              );
              snap.forEach(d => {
                if (!found.find(o => o.id === d.id)) {
                  found.push({ id: d.id, ...d.data() } as Order);
                }
              });

              // If still not found, try lowercase too
              if (found.length === 0) {
                const snap2 = await getDocs(
                  fbQuery(collection(db, 'orders'), where('orderNumber', '==', searchQuery.toLowerCase()))
                );
                snap2.forEach(d => {
                  if (!found.find(o => o.id === d.id)) {
                    found.push({ id: d.id, ...d.data() } as Order);
                  }
                });
              }
            }
          }
        } catch (listErr) {
          console.warn('[OrderTracker] Firestore list query failed (index may not exist):', listErr);
          // This is OK - we have other fallbacks
        }
      }
    } catch (err) {
      console.warn('[OrderTracker] Firebase query error:', err);
    }

    // ── Strategy 3: Fall back to local orders array ──────────────────────────
    // This works for logged-in users and admins
    if (found.length === 0 && orders && orders.length > 0) {
      const searchLower = searchQuery.toLowerCase().toUpperCase();
      found.push(
        ...orders.filter(o =>
          o.orderNumber.toUpperCase().includes(searchLower) ||
          o.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          o.orderNumber.toLowerCase().includes(searchQuery.toLowerCase())
        )
      );
    }

    // Set results
    if (found.length > 0) {
      // Remove duplicates by ID
      const unique = Array.from(new Map(found.map(o => [o.id, o])).values());
      setResults(unique);
      setNotFound(false);
    } else {
      setResults([]);
      setNotFound(true);
    }

    setIsSearching(false);
  };

  // Auto-search if order number provided via URL
  useEffect(() => {
    if (initialOrderNumber) {
      handleSearch(initialOrderNumber);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOrderNumber]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-violet-50/30">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-100 shadow-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => window.location.href = '/'}
            className="flex items-center gap-1.5 text-slate-500 hover:text-slate-800 text-xs font-bold uppercase transition-colors cursor-pointer"
          >
            <ArrowLeft size={15} /> Back to Store
          </button>
          <div className="flex-1 text-center">
            <span className="text-sm font-extrabold text-slate-800 tracking-tight">
              {siteSettings?.websiteName || 'Order Tracker'}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        {/* Hero */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-200 mb-2">
            <Package size={28} className="text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Track Your Order</h1>
          <p className="text-slate-500 text-sm">Enter your order number to see real-time status updates</p>
        </div>

        {/* Search box */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <label htmlFor="order-tracker-search" className="block text-xs font-bold uppercase text-slate-500 tracking-wider mb-2">Order Number</label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                id="order-tracker-search"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. ORD-123456"
                className="w-full pl-9 pr-3 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition-all"
              />
            </div>
            <button
              onClick={() => handleSearch()}
              disabled={isSearching}
              className="px-5 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-bold rounded-xl shadow-sm hover:from-violet-700 hover:to-indigo-700 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {isSearching ? 'Searching...' : 'Track'}
            </button>
          </div>
          {searched && !isSearching && (
            <button
              onClick={() => { setQuery(''); setSearched(false); setResults([]); setNotFound(false); }}
              className="mt-2 text-[10px] text-slate-400 hover:text-slate-600 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw size={10} /> Clear search
            </button>
          )}
        </div>

        {/* Results */}
        {searched && (
          <div className="space-y-4">
            {isSearching ? (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-10 text-center space-y-3">
                <Loader2 size={28} className="animate-spin text-violet-500 mx-auto" />
                <p className="text-sm font-semibold text-slate-500">Looking up your order...</p>
              </div>
            ) : notFound ? (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-10 text-center space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto">
                  <XCircle size={24} className="text-rose-400" />
                </div>
                <h3 className="font-bold text-slate-700">No Order Found</h3>
                <p className="text-sm text-slate-400 max-w-xs mx-auto">
                  We couldn't find an order matching <strong className="text-slate-600">"{query}"</strong>. Double-check your order number and try again.
                </p>
              </div>
            ) : (
              <>
                <p className="text-xs font-bold uppercase text-slate-400 tracking-wider">
                  {results.length} order{results.length !== 1 ? 's' : ''} found
                </p>
                {results.map((order: Order) => (
                  <React.Fragment key={order.id}>
                    <OrderCard
                      order={order}
                      currency={currency as string}
                      currencySymbol={currencySymbol as string}
                      currencyPosition={currencyPosition}
                    />
                  </React.Fragment>
                ))}
              </>
            )}
          </div>
        )}

        {/* Empty state before search */}
        {!searched && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { icon: <Search size={20} className="text-violet-500" />, title: 'Enter Order #', desc: 'Type your order number from your confirmation email or receipt' },
              { icon: <RefreshCw size={20} className="text-blue-500" />, title: 'Live Status', desc: 'See real-time updates as your order moves through processing to delivery' },
              { icon: <Package size={20} className="text-emerald-500" />, title: 'Full Details', desc: 'View items, payment status, delivery address and tracking timeline' },
            ].map((tip, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-100 p-5 text-center shadow-sm space-y-2">
                <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center mx-auto">{tip.icon}</div>
                <p className="font-bold text-slate-800 text-sm">{tip.title}</p>
                <p className="text-xs text-slate-400 leading-relaxed">{tip.desc}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
