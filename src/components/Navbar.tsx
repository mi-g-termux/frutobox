/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from './Toast';
import { ShoppingCart, Search, ShieldAlert, LogIn, UserPlus, User, X, Package } from 'lucide-react';
import { QuirkyFruityLogo } from './PaymentLogos';
import { UserAuthModal } from './UserAuthModal';

interface NavbarProps {
  onCartToggle: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  activeCategory: string | null;
  setActiveCategory: (category: string | null) => void;
}

export const Navbar = ({
  onCartToggle,
  searchQuery,
  setSearchQuery,
  activeCategory,
  setActiveCategory,
}: NavbarProps) => {
  const { siteSettings, cart, isAdminLoggedIn, isUserLoggedIn, userProfile, products, formatPrice } = useApp();
  const [searchOpen, setSearchOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState<'signin' | 'signup'>('signin');
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const searchWrapperRef = useRef<HTMLDivElement>(null);
  const mobileSearchWrapperRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // Filter products for dropdown
  const searchResults = searchQuery.length >= 2
    ? products.filter(p => p.isActive && (
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.category.toLowerCase().includes(searchQuery.toLowerCase())
      )).slice(0, 6)
    : [];

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node) &&
        mobileSearchWrapperRef.current && !mobileSearchWrapperRef.current.contains(e.target as Node)
      ) {
        setSearchDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSearchDropdownOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Open/close dropdown based on query length
  useEffect(() => {
    setSearchDropdownOpen(searchQuery.length >= 2);
  }, [searchQuery]);

  const handleSelectSearchResult = (name: string) => {
    setSearchQuery(name);
    setSearchDropdownOpen(false);
    const el = document.getElementById('product-grid');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <>
      <nav className="sticky top-0 z-40 bg-white border-b border-slate-100 font-sans shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-3">

            {/* Logo & Brand */}
            <a
              href="/"
              onClick={(e) => { e.preventDefault(); setActiveCategory(null); setSearchQuery(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className="flex items-center gap-3 group cursor-pointer flex-shrink-0"
            >
              <div className="w-14 h-14 flex items-center justify-center group-hover:scale-105 transition-transform overflow-hidden flex-shrink-0">
                {siteSettings.logoUrl?.trim() ? (
                  <img src={siteSettings.logoUrl} alt={siteSettings.websiteName || 'Logo'} className="w-full h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <QuirkyFruityLogo className="w-full h-full" />
                )}
              </div>
              <span className="text-lg font-bold tracking-tight text-slate-800 group-hover:text-emerald-600 transition-colors capitalize hidden sm:block">
                {siteSettings.websiteName || 'Fruitopia'}
              </span>
            </a>

            {/* Search Bar — desktop with dropdown */}
            <div className="hidden md:flex flex-1 max-w-sm relative mx-4" ref={searchWrapperRef}>
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none z-10" />
              <input
                type="text"
                placeholder={`Search ${siteSettings.websiteName || 'products'}…`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => { if (searchQuery.length >= 2) setSearchDropdownOpen(true); }}
                className="w-full bg-slate-50 border border-slate-200 pl-10 pr-4 py-2 rounded-full text-sm font-medium text-slate-800 outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all"
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setSearchDropdownOpen(false); }} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 z-10">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              {/* Search Dropdown */}
              {searchDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
                  {searchResults.length === 0 ? (
                    <div className="py-4 px-4 text-center text-xs text-slate-400 font-medium">No products found for "{searchQuery}"</div>
                  ) : (
                    <div>
                      {searchResults.map(prod => (
                        <button
                          key={prod.id}
                          onMouseDown={() => handleSelectSearchResult(prod.name)}
                          className="w-full flex items-center gap-3 py-2.5 px-3 hover:bg-slate-50 cursor-pointer transition-colors text-left"
                        >
                          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {prod.image && (prod.image.startsWith('http') || prod.image.startsWith('data:') || prod.image.startsWith('/')) ? (
                              <img src={prod.image} alt={prod.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            ) : (
                              <span className="text-lg">{prod.image || '🍎'}</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">{prod.name}</p>
                            <p className="text-xs text-slate-400">{prod.category}</p>
                          </div>
                          <span className="text-sm font-bold text-emerald-600 flex-shrink-0">{formatPrice(prod.salePrice ?? prod.price)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-2">

              {/* Mobile search toggle */}
              <button
                onClick={() => setSearchOpen(s => !s)}
                className="md:hidden p-2 rounded-full border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 transition-colors"
                aria-label="Search"
              >
                <Search className="w-4 h-4" />
              </button>

              {/* Auth — logged in */}
              {isUserLoggedIn ? (
                <button
                  onClick={() => { setAuthTab('signin'); setAuthModalOpen(true); }}
                  className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors shadow-xs"
                  title="My Account"
                >
                  <div className="w-6 h-6 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full flex items-center justify-center text-white text-[10px] font-black shadow-sm">
                    {userProfile?.name?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                  <span className="text-xs font-bold text-emerald-700 hidden sm:block max-w-[80px] truncate">
                    {userProfile?.name?.split(' ')[0]}
                  </span>
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setAuthTab('signin'); setAuthModalOpen(true); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-full hover:bg-slate-50 transition-colors"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span className="hidden sm:block">Sign In</span>
                  </button>
                  <button
                    onClick={() => { setAuthTab('signup'); setAuthModalOpen(true); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-500 border border-emerald-500 rounded-full hover:bg-emerald-600 transition-colors shadow-sm"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span className="hidden sm:block">Sign Up</span>
                  </button>
                </div>
              )}

              {/* Admin badge — SPA nav, no full reload */}
              {isAdminLoggedIn && (
                <button
                  onClick={() => { window.history.pushState({}, '', '/admin'); window.dispatchEvent(new PopStateEvent('popstate')); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-full hover:bg-rose-100 transition-colors cursor-pointer"
                  title="Go to Admin Panel"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span className="hidden sm:block">Admin</span>
                </button>
              )}

              {/* Track Order button — shown when admin enables it */}
              {siteSettings?.orderTrackerEnabled !== false && siteSettings?.orderTrackerInNavbar && (
                <button
                  onClick={() => { window.history.pushState({}, '', '/tracker'); window.dispatchEvent(new PopStateEvent('popstate')); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-violet-700 bg-violet-50 border border-violet-200 rounded-full hover:bg-violet-100 transition-colors cursor-pointer whitespace-nowrap"
                  title="Track your order"
                >
                  <Package className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="hidden sm:block">Track Order</span>
                </button>
              )}

              {/* Cart button */}
              <button
                onClick={onCartToggle}
                className="relative p-2.5 bg-slate-100 rounded-full border border-slate-200 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 text-slate-600 transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-xs"
                aria-label="Open cart"
                id="navbar-cart-trigger"
              >
                <ShoppingCart className="w-5 h-5" />
                {cartItemsCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-orange-500 text-white text-[9px] min-w-[18px] h-[18px] rounded-full flex items-center justify-center font-black shadow-sm px-0.5 border-2 border-white">
                    {cartItemsCount > 99 ? '99+' : cartItemsCount}
                  </span>
                )}
              </button>

            </div>
          </div>

          {/* Mobile search — slide down with dropdown */}
          {searchOpen && (
            <div className="pb-3 md:hidden animate-fade-in" ref={mobileSearchWrapperRef}>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none z-10" />
                <input
                  type="text"
                  autoFocus
                  placeholder="Search products…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => { if (searchQuery.length >= 2) setSearchDropdownOpen(true); }}
                  className="w-full bg-slate-50 border border-slate-200 pl-10 pr-10 py-2.5 rounded-xl text-sm font-medium text-slate-800 outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all"
                />
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(''); setSearchDropdownOpen(false); }} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 z-10">
                    <X className="w-4 h-4" />
                  </button>
                )}
                {/* Mobile Search Dropdown */}
                {searchDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
                    {searchResults.length === 0 ? (
                      <div className="py-4 px-4 text-center text-xs text-slate-400 font-medium">No products found for "{searchQuery}"</div>
                    ) : (
                      searchResults.map(prod => (
                        <button
                          key={prod.id}
                          onMouseDown={() => { handleSelectSearchResult(prod.name); setSearchOpen(false); }}
                          className="w-full flex items-center gap-3 py-2.5 px-3 hover:bg-slate-50 cursor-pointer transition-colors text-left"
                        >
                          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {prod.image && (prod.image.startsWith('http') || prod.image.startsWith('data:') || prod.image.startsWith('/')) ? (
                              <img src={prod.image} alt={prod.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            ) : (
                              <span className="text-lg">{prod.image || '🍎'}</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">{prod.name}</p>
                            <p className="text-xs text-slate-400">{prod.category}</p>
                          </div>
                          <span className="text-sm font-bold text-emerald-600 flex-shrink-0">{formatPrice(prod.salePrice ?? prod.price)}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </nav>

      <UserAuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} defaultTab={authTab} />
    </>
  );
};
