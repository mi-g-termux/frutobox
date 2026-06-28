/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useApp } from '../context/AppContext';
import { Sparkles, ArrowDown, Clock } from 'lucide-react';
import { QuirkyFruityLogo } from './PaymentLogos';

export const Hero: React.FC = () => {
  const { siteSettings } = useApp();

  const handleScrollToMenu = () => {
    const section = document.getElementById('menu');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="bg-slate-50 relative overflow-hidden font-sans border-b border-slate-100">
      <div className="max-w-7xl mx-auto px-6 py-12 lg:py-16 bg-sleek-pattern relative z-10">
        
        {/* Promotion Top Announcement Banner */}
        {siteSettings.promoBannerEnabled && siteSettings.promoBannerText && (
          <div className="max-w-4xl mx-auto mb-8 bg-emerald-100/60 border border-emerald-200 rounded-full px-5 py-2 text-center shadow-xs">
            <p className="font-sans font-semibold text-xs sm:text-sm text-emerald-800 flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600 animate-pulse" />
              <span>{siteSettings.promoBannerText}</span>
            </p>
          </div>
        )}

        {/* Campaign Hero Banner Outer Layout */}
        <section className="bg-emerald-50 rounded-3xl p-8 sm:p-10 md:p-12 flex flex-col md:flex-row items-center justify-between border border-emerald-100 shadow-sm gap-8">
          
          <div className="max-w-xl text-center md:text-left flex-1">
            <span className="inline-block px-3 py-1 bg-emerald-200/50 text-emerald-800 text-[10px] font-bold uppercase rounded-full mb-4 tracking-wide shadow-sm">
              {siteSettings.heroBadge || 'Deliciously Fresh menu!'}
            </span>
            
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-800 leading-tight mb-4 tracking-tight">
              {siteSettings.heroTitleLine1 || 'Treat yourself'} <br />
              <span className="text-emerald-600">{siteSettings.heroTitleLine2 || 'with something fresh & tasty!'}</span>
            </h1>

            <p className="text-slate-600 mb-6 font-normal text-sm sm:text-base leading-relaxed">
              {siteSettings.heroSubtitle || 'Handcrafted with premium fresh organic ingredients, serving smiles with every vibrant drop.'}
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-4 py-1 justify-center md:justify-start">
              <button
                onClick={handleScrollToMenu}
                className="bg-slate-900 text-white px-8 py-3 rounded-xl font-bold shadow-md shadow-slate-200 hover:bg-slate-800 transition-all cursor-pointer flex items-center justify-center gap-2 hover:translate-y-[-1px] active:translate-y-[0.5px]"
                id="hero-see-menu"
              >
                <span>{siteSettings.heroButtonText || 'SEE MENU & ORDER'}</span>
                <ArrowDown className="w-4 h-4 text-emerald-400" />
              </button>

              {/* Secure Hours badge */}
              <div className="flex items-center gap-2 text-slate-500 font-medium text-xs sm:text-sm bg-white/70 backdrop-blur-xs px-4 py-2 rounded-xl border border-slate-100 shadow-sm">
                <Clock className="w-4 h-4 text-emerald-500" />
                <span className="uppercase tracking-wider">
                  {siteSettings.heroTimeBadge || 'open from 8 am – 10 pm'}
                </span>
              </div>
            </div>
          </div>

          {/* Right showcase: Brand logo display panel */}
          <div className="flex-shrink-0 relative h-48 w-48 sm:h-56 sm:w-56 aspect-square flex items-center justify-center bg-white rounded-3xl shadow-xl border border-white/80 overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-tr from-orange-100/30 to-emerald-100/30 pointer-events-none"></div>
            <div
              style={{ animation: 'heroFloat 4s ease-in-out infinite' }}
              className="w-36 h-36 select-none relative z-10 transition-transform duration-300 group-hover:scale-110 flex items-center justify-center"
            >
              {siteSettings.logoUrl && siteSettings.logoUrl.trim() !== '' ? (
                <img
                  src={siteSettings.logoUrl}
                  alt={siteSettings.websiteName || 'Brand Logo'}
                  className="w-full h-full object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <QuirkyFruityLogo className="w-full h-full" />
              )}
            </div>
          </div>

        </section>

      </div>
    </div>
  );
};
