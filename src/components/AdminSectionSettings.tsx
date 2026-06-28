/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from './Toast';
import { Save, Upload, X } from 'lucide-react';
import { SiteSettings } from '../types';

export const AdminSectionSettings: React.FC = () => {
  const { siteSettings, saveSiteSettings } = useApp();
  const toast = useToast();

  // Newsletter Section
  const [newsletterTitle, setNewsletterTitle] = useState('');
  const [newsletterSubtitle, setNewsletterSubtitle] = useState('');
  const [newsletterSubmitButtonText, setNewsletterSubmitButtonText] = useState('');
  const [newsletterIconInput, setNewsletterIconInput] = useState('');
  const [newsletterIconPreview, setNewsletterIconPreview] = useState('');

  // Testimonial Section
  const [testimonialTitle, setTestimonialTitle] = useState('');
  const [testimonialSubtitle, setTestimonialSubtitle] = useState('');
  const [testimonialDisplayCount, setTestimonialDisplayCount] = useState(3);
  const [testimonialIconInput, setTestimonialIconInput] = useState('');
  const [testimonialIconPreview, setTestimonialIconPreview] = useState('');

  const [isSaving, setIsSaving] = useState(false);

  // Load initial values
  useEffect(() => {
    if (siteSettings) {
      setNewsletterTitle(siteSettings.newsletterTitle || 'Newsletter Registration');
      setNewsletterSubtitle(siteSettings.newsletterSubtitle || 'Stay updated with fresh recipes & exclusive coupons');
      setNewsletterSubmitButtonText(siteSettings.newsletterSubmitButtonText || 'Submit Email');
      setNewsletterIconInput(siteSettings.newsletterSectionIcon || '');
      setNewsletterIconPreview(siteSettings.newsletterSectionIcon || '');

      setTestimonialTitle(siteSettings.testimonialTitle || 'Client Love & Testimonials');
      setTestimonialSubtitle(siteSettings.testimonialSubtitle || 'Deliciously Recommended!');
      setTestimonialDisplayCount(siteSettings.testimonialDisplayCount || 3);
      setTestimonialIconInput(siteSettings.testimonialSectionIcon || '');
      setTestimonialIconPreview(siteSettings.testimonialSectionIcon || '');
    }
  }, [siteSettings]);

  const handleNewsletterIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setNewsletterIconInput(base64);
        setNewsletterIconPreview(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleTestimonialIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setTestimonialIconInput(base64);
        setTestimonialIconPreview(base64);
      };
      reader.readAsDataURL(file);
    };
  };

  const handleSaveSettings = async () => {
    if (!siteSettings) return;

    setIsSaving(true);
    try {
      const updatedSettings: SiteSettings = {
        ...siteSettings,
        newsletterTitle,
        newsletterSubtitle,
        newsletterSubmitButtonText,
        newsletterSectionIcon: newsletterIconInput,
        testimonialTitle,
        testimonialSubtitle,
        testimonialDisplayCount,
        testimonialSectionIcon: testimonialIconInput,
      };

      await saveSiteSettings(updatedSettings);
      toast.success('Section settings saved successfully!');
    } catch (err) {
      toast.error('Failed to save section settings.');
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetNewsletterIcon = () => {
    setNewsletterIconInput('');
    setNewsletterIconPreview('');
  };

  const handleResetTestimonialIcon = () => {
    setTestimonialIconInput('');
    setTestimonialIconPreview('');
  };

  return (
    <div className="space-y-8">
      {/* Newsletter Section Settings */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8">
        <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
          📧 Newsletter Section Settings
        </h3>

        <div className="space-y-4">
          {/* Newsletter Title */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Newsletter Section Title
            </label>
            <input
              type="text"
              value={newsletterTitle}
              onChange={(e) => setNewsletterTitle(e.target.value)}
              placeholder="e.g., Newsletter Registration"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-normal text-slate-700 focus:bg-white outline-none focus:ring-2 focus:ring-emerald-400 transition-all"
            />
          </div>

          {/* Newsletter Subtitle */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Newsletter Section Subtitle
            </label>
            <input
              type="text"
              value={newsletterSubtitle}
              onChange={(e) => setNewsletterSubtitle(e.target.value)}
              placeholder="e.g., Stay updated with fresh recipes & exclusive coupons"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-normal text-slate-700 focus:bg-white outline-none focus:ring-2 focus:ring-emerald-400 transition-all"
            />
          </div>

          {/* Newsletter Submit Button Text */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Submit Button Text
            </label>
            <input
              type="text"
              value={newsletterSubmitButtonText}
              onChange={(e) => setNewsletterSubmitButtonText(e.target.value)}
              placeholder="e.g., Submit Email"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-normal text-slate-700 focus:bg-white outline-none focus:ring-2 focus:ring-emerald-400 transition-all"
            />
          </div>

          {/* Newsletter Icon */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Newsletter Section Icon
            </label>
            <div className="flex gap-4 items-start">
              <div className="flex-1">
                <div className="relative">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleNewsletterIconChange}
                    className="hidden"
                    id="newsletter-icon-upload"
                  />
                  <label
                    htmlFor="newsletter-icon-upload"
                    className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border-2 border-dashed border-emerald-300 rounded-xl cursor-pointer hover:bg-emerald-100 transition-all"
                  >
                    <Upload className="w-4 h-4 text-emerald-600" />
                    <span className="text-sm font-medium text-emerald-700">
                      Upload Icon (PNG/SVG)
                    </span>
                  </label>
                </div>
                {newsletterIconPreview && (
                  <div className="mt-3 flex items-center gap-3">
                    <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center overflow-hidden">
                      {newsletterIconInput.startsWith('<svg') ? (
                        <span
                          className="w-8 h-8"
                          dangerouslySetInnerHTML={{ __html: newsletterIconInput }}
                        />
                      ) : (
                        <img src={newsletterIconPreview} alt="Newsletter icon" className="w-8 h-8 object-cover" />
                      )}
                    </div>
                    <button
                      onClick={handleResetNewsletterIcon}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    >
                      <X className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Testimonial Section Settings */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8">
        <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
          ⭐ Testimonial Section Settings
        </h3>

        <div className="space-y-4">
          {/* Testimonial Title */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Testimonial Section Title
            </label>
            <input
              type="text"
              value={testimonialTitle}
              onChange={(e) => setTestimonialTitle(e.target.value)}
              placeholder="e.g., Client Love & Testimonials"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-normal text-slate-700 focus:bg-white outline-none focus:ring-2 focus:ring-emerald-400 transition-all"
            />
          </div>

          {/* Testimonial Subtitle */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Testimonial Section Subtitle
            </label>
            <input
              type="text"
              value={testimonialSubtitle}
              onChange={(e) => setTestimonialSubtitle(e.target.value)}
              placeholder="e.g., Deliciously Recommended!"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-normal text-slate-700 focus:bg-white outline-none focus:ring-2 focus:ring-emerald-400 transition-all"
            />
          </div>

          {/* Display Count */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Number of Testimonials to Display
            </label>
            <select
              value={testimonialDisplayCount}
              onChange={(e) => setTestimonialDisplayCount(parseInt(e.target.value))}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-normal text-slate-700 focus:bg-white outline-none focus:ring-2 focus:ring-emerald-400 transition-all"
            >
              {[1, 2, 3, 4, 5, 6].map((num) => (
                <option key={num} value={num}>
                  {num} Testimonial{num > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Testimonial Icon */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Testimonial Section Icon
            </label>
            <div className="flex gap-4 items-start">
              <div className="flex-1">
                <div className="relative">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleTestimonialIconChange}
                    className="hidden"
                    id="testimonial-icon-upload"
                  />
                  <label
                    htmlFor="testimonial-icon-upload"
                    className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border-2 border-dashed border-emerald-300 rounded-xl cursor-pointer hover:bg-emerald-100 transition-all"
                  >
                    <Upload className="w-4 h-4 text-emerald-600" />
                    <span className="text-sm font-medium text-emerald-700">
                      Upload Icon (PNG/SVG)
                    </span>
                  </label>
                </div>
                {testimonialIconPreview && (
                  <div className="mt-3 flex items-center gap-3">
                    <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center overflow-hidden">
                      {testimonialIconInput.startsWith('<svg') ? (
                        <span
                          className="w-8 h-8"
                          dangerouslySetInnerHTML={{ __html: testimonialIconInput }}
                        />
                      ) : (
                        <img src={testimonialIconPreview} alt="Testimonial icon" className="w-8 h-8 object-cover" />
                      )}
                    </div>
                    <button
                      onClick={handleResetTestimonialIcon}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    >
                      <X className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <button
          onClick={handleSaveSettings}
          disabled={isSaving}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          <Save className="w-5 h-5" />
          <span>{isSaving ? 'Saving...' : 'Save All Settings'}</span>
        </button>
      </div>
    </div>
  );
};
