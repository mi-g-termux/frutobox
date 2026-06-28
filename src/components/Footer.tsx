/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useApp } from '../context/AppContext';
import { Mail, Phone, MapPin, Facebook, Instagram, Twitter } from 'lucide-react';
import { QuirkyFruityLogo } from './PaymentLogos';

// Detect legacy/placeholder brand strings so we never leak the original demo
// name once the admin has renamed the store.
const LEGACY_BRAND_RE = /quirky[\s-]?fruity/i;

export const Footer: React.FC = () => {
  const { siteSettings } = useApp();

  const storeName = (siteSettings.websiteName || 'Store').trim();
  const year = new Date().getFullYear();

  // If admin-saved trademark text still contains the legacy demo brand,
  // override it with a dynamic copyright line based on the live store name.
  const rawTrademark = siteSettings.trademarkText || '';
  const trademark =
    !rawTrademark.trim() || LEGACY_BRAND_RE.test(rawTrademark)
      ? `© ${year} ${storeName}. All rights reserved.`
      : rawTrademark;

  const rawFooterText = siteSettings.footerText || '';
  const footerText =
    !rawFooterText.trim() || LEGACY_BRAND_RE.test(rawFooterText)
      ? `${storeName} — serving fresh, handcrafted goodness to nourish your day.`
      : rawFooterText;

  const contactEmail =
    siteSettings.contactEmail && !LEGACY_BRAND_RE.test(siteSettings.contactEmail)
      ? siteSettings.contactEmail
      : `hello@${storeName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;

  return (
    <footer className="bg-slate-900 font-sans text-white border-t border-slate-800 px-6 py-12 lg:py-16 shadow-inner">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-10">

        {/* Column 1: Brand details */}
        <div className="md:col-span-4 flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <div className="bg-slate-800 border border-slate-700 p-1 rounded-lg shadow-sm w-9 h-9 flex items-center justify-center overflow-hidden flex-shrink-0">
              {siteSettings.logoUrl && siteSettings.logoUrl.trim() !== '' ? (
                <img
                  src={siteSettings.logoUrl}
                  alt={storeName}
                  className="w-full h-full object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <QuirkyFruityLogo className="w-full h-full" />
              )}
            </div>
            <span className="text-xl font-bold tracking-tight text-emerald-500 capitalize">
              {storeName}
            </span>
          </div>
          <p className="text-xs text-slate-400 font-normal leading-relaxed max-w-sm">
            {footerText}
          </p>

          {/* Social logos */}
          <div className="flex items-center gap-2.5 mt-2">
            <a
              href={siteSettings.socialFacebook || '#'}
              target="_blank"
              referrerPolicy="no-referrer"
              className="p-2.5 bg-slate-800 hover:bg-emerald-500 hover:text-white rounded-full border border-slate-700/50 transition-all shadow-sm"
              aria-label="Facebook Page link"
            >
              <Facebook className="w-4 h-4 text-slate-300 hover:text-white" />
            </a>
            <a
              href={siteSettings.socialInstagram || '#'}
              target="_blank"
              referrerPolicy="no-referrer"
              className="p-2.5 bg-slate-800 hover:bg-emerald-500 hover:text-white rounded-full border border-slate-700/50 transition-all shadow-sm"
              aria-label="Instagram Page link"
            >
              <Instagram className="w-4 h-4 text-slate-300 hover:text-white" />
            </a>
            <a
              href={siteSettings.socialTwitter || '#'}
              target="_blank"
              referrerPolicy="no-referrer"
              className="p-2.5 bg-slate-800 hover:bg-emerald-500 hover:text-white rounded-full border border-slate-700/50 transition-all shadow-sm"
              aria-label="Twitter Page link"
            >
              <Twitter className="w-4 h-4 text-slate-300 hover:text-white" />
            </a>
          </div>
        </div>

        {/* Column 2: Navigation targets */}
        <div className="md:col-span-4 flex flex-col gap-3">
          <h4 className="text-xs font-bold uppercase text-emerald-400 tracking-wider">Quick Navigation</h4>
          <ul className="space-y-2 text-xs text-slate-400 font-medium uppercase">
            {siteSettings.footerLinks?.map((link, idx) => (
              <li key={idx}>
                <a href={link.url} className="hover:text-emerald-400 transition-colors flex items-center gap-1.5">
                  <span className="text-emerald-500">●</span> <span>{link.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Column 3: Contact details */}
        <div className="md:col-span-4 flex flex-col gap-4">
          <h4 className="text-xs font-bold uppercase text-emerald-400 tracking-wider">Get In Touch</h4>
          <ul className="space-y-3 text-xs text-slate-400 font-medium">
            <li className="flex items-start gap-2.5">
              <MapPin className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <span>{siteSettings.contactAddress || '—'}</span>
            </li>
            <li className="flex items-center gap-2.5">
              <Phone className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <span>{siteSettings.contactPhone || '—'}</span>
            </li>
            <li className="flex items-center gap-2.5">
              <Mail className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <a href={`mailto:${contactEmail}`} className="hover:text-emerald-400 transition-colors">
                {contactEmail}
              </a>
            </li>
          </ul>
        </div>

      </div>

      <div className="max-w-7xl mx-auto mt-12 pt-6 border-t border-slate-800 text-center text-xs text-slate-500 font-medium">
        <p>{trademark}</p>
      </div>
    </footer>
  );
};
