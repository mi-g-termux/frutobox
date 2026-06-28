/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from './Toast';
import { Send } from 'lucide-react';

// Professional envelope/mail icon SVG (default when no custom icon set)
const DefaultNewsletterIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <rect x="2" y="4" width="20" height="16" rx="3" fill="currentColor" opacity="0.15"/>
    <rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M2 8L10.586 13.414C11.367 13.961 12.633 13.961 13.414 13.414L22 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

export const Newsletter: React.FC = () => {
  const { subscribeNewsletter, siteSettings } = useApp();
  const toast = useToast();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Use customizable settings from Firebase with fallbacks
  const newsletterTitle = siteSettings?.newsletterTitle || 'Newsletter Registration';
  const newsletterSubtitle = siteSettings?.newsletterSubtitle || 'Stay updated with fresh recipes & exclusive coupons';
  const submitButtonText = siteSettings?.newsletterSubmitButtonText || 'Submit Email';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsSubmitting(true);
    try {
      const resp = await subscribeNewsletter(email);
      if (resp.success) {
        toast.success(`Registered! Greetings ${firstName || 'Friend'}. You are now subscribed.`);
        setFirstName('');
        setLastName('');
        setEmail('');
        setSubject('');
        setMessage('');
      } else {
        toast.error(resp.message);
      }
    } catch (err) {
      toast.error('Newsletter service error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const customIcon = siteSettings?.newsletterSectionIcon?.trim();

  return (
    <section
      className="py-16 px-6 sm:px-8 border-b border-slate-100 font-sans text-center bg-slate-50 relative bg-sleek-pattern"
      id="newsletter"
    >
      <div className="max-w-xl mx-auto bg-white border border-slate-100 rounded-2xl p-6 sm:p-8 shadow-md relative z-10 text-left">
        
        {/* Professional icon bubble */}
        <div className="absolute -top-7 left-1/2 transform -translate-x-1/2 bg-emerald-600 text-white rounded-full h-14 w-14 flex items-center justify-center shadow-lg border-2 border-white">
          {customIcon ? (
            customIcon.startsWith('<svg') ? (
              <span className="w-7 h-7" dangerouslySetInnerHTML={{ __html: customIcon }} />
            ) : (
              <img src={customIcon} alt="newsletter icon" className="w-8 h-8 object-contain" />
            )
          ) : (
            <DefaultNewsletterIcon className="w-7 h-7 text-white" />
          )}
        </div>

        <div className="text-center mb-8 mt-4">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800 uppercase tracking-wide">
            {newsletterTitle}
          </h2>
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mt-1.5">
            {newsletterSubtitle}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="news-firstname" className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                First Name *
              </label>
              <input
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First Name"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm font-normal text-slate-700 focus:bg-white outline-none focus:ring-2 focus:ring-emerald-400 transition-all font-sans"
                id="news-firstname"
              />
            </div>
            <div>
              <label htmlFor="news-lastname" className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                Last Name *
              </label>
              <input
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last Name"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm font-normal text-slate-700 focus:bg-white outline-none focus:ring-2 focus:ring-emerald-400 transition-all font-sans"
                id="news-lastname"
              />
            </div>
          </div>

          <div>
            <label htmlFor="news-email" className="block text-xs font-semibold uppercase text-slate-500 mb-1">
              Email Address *
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email (e.g. hello@example.com)"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm font-normal text-slate-700 focus:bg-white outline-none focus:ring-2 focus:ring-emerald-400 transition-all font-sans"
              id="news-email"
            />
          </div>

          <div>
            <label htmlFor="news-subject" className="block text-xs font-semibold uppercase text-slate-500 mb-1">
              Email Subject *
            </label>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email Subject"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm font-normal text-slate-700 focus:bg-white outline-none focus:ring-2 focus:ring-emerald-400 transition-all font-sans"
              id="news-subject"
            />
          </div>

          <div>
            <label htmlFor="news-message" className="block text-xs font-semibold uppercase text-slate-500 mb-1">
              Message
            </label>
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter optional message details..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm font-normal text-slate-700 focus:bg-white outline-none focus:ring-2 focus:ring-emerald-400 transition-all resize-none font-sans"
              id="news-message"
            ></textarea>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-slate-900 text-white hover:bg-slate-800 font-semibold uppercase rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 text-xs tracking-wider shadow-sm hover:shadow-md"
              id="news-submit-btn"
            >
              <Send className="w-4 h-4 text-emerald-400" />
              <span>{isSubmitting ? 'SUBMITTING...' : submitButtonText.toUpperCase()}</span>
            </button>
          </div>

        </form>
      </div>
    </section>
  );
};
