/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useEffect } from'react';
import { useApp } from'../context/AppContext';
import { useToast } from'./Toast';
import { AdminSectionSettings } from'./AdminSectionSettings';
import { clearFirebaseConfig } from '../firebase';
import { disconnectSupabase, getIsSupabaseConfigured, getSupabaseRuntimeConfig, resolveSupabaseConfig, onSupabaseAnySettingChange } from '../supabase';
import { clearInstallLock } from '../installStatus';
import { getIsFirebaseConfigured, DYNAMIC_FIREBASE_KEY } from'../firebase';
import {
 fileToBase64,
 validateImageFile,
} from'../firestore-service';
import {
 Settings,
 Package,
 ShoppingBag,
 Ticket,
 Users,
 Star,
 Plus,
 Trash2,
 Edit2,
 CheckCircle,
 XCircle,
 Save,
 LogOut,
 Mail,
 Shield,
 KeyRound,
 Eye,
 EyeOff,
 Check,
 Phone,
 RefreshCw,
 Download,
 Palette,
 Server,
} from'lucide-react';
import { Product, Coupon, Category, DeliveryZone, ProductImage, ProductVariant, ProductVariantGroup } from'../types';
import { getActiveEngine, simpleHash, hashPassword, dbService, saveProductImages, getProductImages, saveProductVariantGroups, getProductVariantGroups, saveProductVariants, getProductVariants } from '../db';


export const AdminPanel: React.FC = () => {
 const {
 products,
 categories,
 orders,
 coupons,
 newsletterSubscribers,
 reviews,
 siteSettings,
 smtpSettings,
 smsSettings,
 emailVerificationSettings,
 paymentSettings,
 adminSettings,
 supportSettings,
 isAdminLoggedIn,
 isLoading,

 addProduct,
 editProduct,
 deleteProduct,
 addCategory,
 editCategory,
 deleteCategory,
 updateOrderStatus,
 updateOrderPaymentStatus,
 deleteOrder,
 editOrderNumber,
 addCoupon,
 deleteCoupon,
 deleteSubscriber,
 addReview,
 approveReview,
 deleteReview,
 saveSiteSettings,
 saveSMTPSettings,
 savePaymentSettings,
 saveAdminSettings,
 saveSupportSettings,
 saveSMSSettings,
 saveEmailVerificationSettings,
 setAdminLoggedIn,
 formatPrice,
 deliveryZones,
 saveDeliveryZonesCtx,
 databaseEngine,
 } = useApp();

 const toast = useToast();

 // Route Login input
 const [usernameInput, setUsernameInput] = useState('');
 const [passwordInput, setPasswordInput] = useState('');
 const [loginError, setLoginError] = useState('');
 const [loginSuccess, setLoginSuccess] = useState('');
 const [showPassword, setShowPassword] = useState(false);
 const [loginLoading, setLoginLoading] = useState(false);

 // --- BRUTE FORCE / LOCKOUT PROTECTION ---
 const LOCKOUT_KEY = 'qf_login_lockout';
 const MAX_ATTEMPTS = 5;
 const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
 const [loginAttemptCount, setLoginAttemptCount] = useState<number>(() => {
   try { const d = JSON.parse(localStorage.getItem(LOCKOUT_KEY) || '{}'); return d.count || 0; } catch { return 0; }
 });
 const [lockoutUntil, setLockoutUntil] = useState<number | null>(() => {
   try { const d = JSON.parse(localStorage.getItem(LOCKOUT_KEY) || '{}'); return (d.until && Date.now() < d.until) ? d.until : null; } catch { return null; }
 });
 const [lockoutRemaining, setLockoutRemaining] = useState<number>(0);
 useEffect(() => {
   if (!lockoutUntil) { setLockoutRemaining(0); return; }
   const tick = () => {
     const rem = Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
     setLockoutRemaining(rem);
     if (rem === 0) { setLockoutUntil(null); setLoginAttemptCount(0); try { localStorage.removeItem(LOCKOUT_KEY); } catch {} }
   };
   tick();
   const iv = setInterval(tick, 1000);
   return () => clearInterval(iv);
 }, [lockoutUntil]);

 // TASK 15: Session expiry check — runs on mount and every 60 seconds
 useEffect(() => {
 const check = () => {
 try {
 const s = JSON.parse(localStorage.getItem('qf_admin_session') ||'null');
 if (isAdminLoggedIn && (!s?.token || !s?.expiresAt || Date.now() >= s.expiresAt)) {
 setAdminLoggedIn(false);
 toast.error('Session expired. Please log in again.');
 }
 } catch {
 if (isAdminLoggedIn) {
 setAdminLoggedIn(false);
 toast.error('Session expired. Please log in again.');
 }
 }
 };
 check();
 const iv = setInterval(check, 60000);
 return () => clearInterval(iv);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 // ── Supabase realtime sync pulse indicator ────────────────────────────────
 const [realtimePulse, setRealtimePulse] = useState(false);
 useEffect(() => {
   if (databaseEngine !== 'supabase') return;
   let timer: ReturnType<typeof setTimeout>;
   const unsub = onSupabaseAnySettingChange(() => {
     setRealtimePulse(true);
     clearTimeout(timer);
     timer = setTimeout(() => setRealtimePulse(false), 5000);
   });
   return () => { unsub(); clearTimeout(timer); };
 }, [databaseEngine]);

 // Primary active Admin tab
 const [activeTab, setActiveTab] = useState<'products' |'orders' |'coupons' |'reviews' |'subscribers' |'sections' |'settings' |'backend'>('products');

 // Multi-Section settings tab index
 const [settingsSection, setSettingsSection] = useState<'general' |'smtp' |'sms' |'payment' |'security' |'support' |'delivery' |'firebase'>('general');
 const [smtpSubTab, setSmtpSubTab] = useState<'server' | 'templates'>('server');
 const [templatePreview, setTemplatePreview] = useState<Record<string, boolean>>({});



 // Delivery zones local state
 const [localZones, setLocalZones] = useState<DeliveryZone[]>([]);

 useEffect(() => {
 if (settingsSection ==='delivery') {
 setLocalZones(deliveryZones);
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [settingsSection]);

 // --- SUBSTATES FOR ADD/EDIT PRODUCTS ---
 const [isProductFormOpen, setIsProductFormOpen] = useState(false);
 const [editingProduct, setEditingProduct] = useState<Product | null>(null);
 // --- CSV BULK IMPORT ---
 const [csvImporting, setCsvImporting] = useState(false);
 const [csvResults, setCsvResults] = useState<{ imported: number; failed: number; errors: string[] } | null>(null);
 const [prodName, setProdName] = useState('');
 const [prodDesc, setProdDesc] = useState('');
 const [prodPrice, setProdPrice] = useState(0);
 const [prodSalePrice, setProdSalePrice] = useState<number | null>(null);
 const [prodStock, setProdStock] = useState(0);
 const [prodImage, setProdImage] = useState('');
 const [prodCategory, setProdCategory] = useState('');
 const [prodFeatured, setProdFeatured] = useState(false);
 const [prodImageMode, setProdImageMode] = useState<'emoji' |'url'>('emoji');
 const [prodImageUploadError, setProdImageUploadError] = useState('');
 const [prodImagePreview, setProdImagePreview] = useState('');

 // --- GALLERY IMAGES ---
 const [galleryImages, setGalleryImages] = useState<ProductImage[]>([]);
 const [galleryUploadError, setGalleryUploadError] = useState('');

 // --- VARIANTS ---
 const [variantGroups, setVariantGroups] = useState<ProductVariantGroup[]>([]);
 const [variantRows, setVariantRows] = useState<ProductVariant[]>([]);
 // Per-product mode toggle: single (one price/stock) vs variant (multi-row).
 // Default 'single' for new products so store owners who only sell simple
 // items never see the variant editor — they explicitly opt in.
 const [productMode, setProductMode] = useState<'single' | 'variant'>('single');
 const [newGroupName, setNewGroupName] = useState('');
 const [newVariantInput, setNewVariantInput] = useState<Record<string, { value: string; price: string; stock: string; imageUrl: string }>>({});

 // --- SUBSTATES FOR ADDING A COUPON ---
 const [isCouponFormOpen, setIsCouponFormOpen] = useState(false);
 const [coupCode, setCoupCode] = useState('');
 const [coupDiscount, setCoupDiscount] = useState(10);
 const [coupExpiry, setCoupExpiry] = useState('');
 const [coupLimit, setCoupLimit] = useState(100);

 // --- SUBSTATES FOR QUICK CATEGORY CREATION ---
 const [newCatName, setNewCatName] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState('🏷️');
 const [newCatImageUrl, setNewCatImageUrl] = useState('');
 const [newCatImageMode, setNewCatImageMode] = useState<'emoji' |'picture'>('emoji');
 const [editCatImageMode, setEditCatImageMode] = useState<'emoji' |'picture'>('emoji');
 const [editCatImageUrl, setEditCatImageUrl] = useState('');

 // --- SUBSTATES FOR CATEGORY EDITING ---
 const [editingCatId, setEditingCatId] = useState<string | null>(null);
 const [editCatName, setEditCatName] = useState('');
  const [editCatEmoji, setEditCatEmoji] = useState('');

 // --- SUBSTATES FOR INJECTING CUSTOM REVIEW ---
 const [newReviewProdId, setNewReviewProdId] = useState('');
 const [newReviewAuthor, setNewReviewAuthor] = useState('');
 const [newReviewRating, setNewReviewRating] = useState(5);
 const [newReviewComment, setNewReviewComment] = useState('');

 // --- CUSTOM ROBUST CONFIRM STATE INSTEAD OF BLOCKED WINDOW.CONFIRM ---
 const [confirmState, setConfirmState] = useState<{
 isOpen: boolean;
 title: string;
 message: string;
 onConfirm: () => void | Promise<void>;
 }>({
 isOpen: false,
 title:'',
 message:'',
 onConfirm: () => {},
 });

 const triggerConfirm = (title: string, message: string, onConfirm: () => void | Promise<void>) => {
 setConfirmState({
 isOpen: true,
 title,
 message,
 onConfirm: async () => {
 try {
 await onConfirm();
 } catch (err) {
 console.error("Confirmation execution action failed:", err);
 }
 setConfirmState(prev => ({ ...prev, isOpen: false }));
 }
 });
 };

 // --- SHIPPING ORDER NUMBER EDITING ---
 const [selectedOrderIdToEdit, setSelectedOrderIdToEdit] = useState<string | null>(null);
 const [tempOrderNumber, setTempOrderNumber] = useState('');

 // --- SAVE SUCCESS BANNER ---
 const [savedBanner, setSavedBanner] = useState<{ show: boolean; type: string }>({ show: false, type:'' });
 const showSavedBanner = (type: string) => {
 setSavedBanner({ show: true, type });
 setTimeout(() => setSavedBanner({ show: false, type:'' }), 1500);
 };

 // --- CURRENCY SETTINGS ---
 const CURRENCIES = [
 { code:'USD', symbol:'$', name:'US Dollar', position:'before' },
 { code:'EUR', symbol:'€', name:'Euro', position:'before' },
 { code:'GBP', symbol:'£', name:'British Pound', position:'before' },
 { code:'BDT', symbol:'৳', name:'Bangladeshi Taka', position:'before' },
 { code:'INR', symbol:'₹', name:'Indian Rupee', position:'before' },
 { code:'AED', symbol:'د.إ', name:'UAE Dirham', position:'after' },
 { code:'SAR', symbol:'﷼', name:'Saudi Riyal', position:'before' },
 { code:'PKR', symbol:'₨', name:'Pakistani Rupee', position:'before' },
 { code:'MYR', symbol:'RM', name:'Malaysian Ringgit', position:'before' },
 { code:'CAD', symbol:'CA$', name:'Canadian Dollar', position:'before' },
 { code:'AUD', symbol:'A$', name:'Australian Dollar', position:'before' },
 { code:'JPY', symbol:'¥', name:'Japanese Yen', position:'before' },
 { code:'CNY', symbol:'¥', name:'Chinese Yuan', position:'before' },
 { code:'TRY', symbol:'₺', name:'Turkish Lira', position:'before' },
 { code:'NGN', symbol:'₦', name:'Nigerian Naira', position:'before' },
 ] as const;
 const [selectedCurrency, setSelectedCurrency] = useState(siteSettings.currency ||'USD');
 const [customSymbol, setCustomSymbol] = useState(siteSettings.currencySymbol ||'$');
 const [currencyPosition, setCurrencyPosition] = useState<'before'|'after'>(siteSettings.currencyPosition ||'before');

 // Sync currency fields ONCE when Firestore data first arrives (initial load only)
 const currencyInitialized = React.useRef(false);
 useEffect(() => {
 if (!currencyInitialized.current && siteSettings.currencySymbol) {
 setSelectedCurrency(siteSettings.currency ||'USD');
 setCustomSymbol(siteSettings.currencySymbol ||'$');
 setCurrencyPosition(siteSettings.currencyPosition ||'before');
 currencyInitialized.current = true;
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [siteSettings.currency, siteSettings.currencySymbol, siteSettings.currencyPosition]);

 // --- DYNAMIC BRANDING FORM FIELDS ---
 const [brandName, setBrandName] = useState(siteSettings.websiteName || 'Fruitopia');
 const [siteTitle, setSiteTitle] = useState(siteSettings.siteTitle ||'');
 const [brandLogoUrl, setBrandLogoUrl] = useState(siteSettings.logoUrl ||'');
 const [brandLogoUploadError, setBrandLogoUploadError] = useState('');
 const [brandLogoPreview, setBrandLogoPreview] = useState(siteSettings.logoUrl ||'');
 const [heroBadgeText, setHeroBadgeText] = useState(siteSettings.heroBadge ||'');
 const [heroLine1, setHeroLine1] = useState(siteSettings.heroTitleLine1 ||'');
 const [heroLine2, setHeroLine2] = useState(siteSettings.heroTitleLine2 ||'');
 const [heroSubText, setHeroSubText] = useState(siteSettings.heroSubtitle ||'');
 const [heroBtnText, setHeroBtnText] = useState(siteSettings.heroButtonText ||'');
 const [heroHours, setHeroHours] = useState(siteSettings.heroTimeBadge ||'');
 const [footerCopy, setFooterCopy] = useState(siteSettings.footerText ||'');
 const [footerPhone, setFooterPhone] = useState(siteSettings.contactPhone ||'');
 const [footerMail, setFooterMail] = useState(siteSettings.contactEmail ||'');
 const [footerLoc, setFooterLoc] = useState(siteSettings.contactAddress ||'');
 const [trademarkTextVal, setTrademarkTextVal] = useState(siteSettings.trademarkText ||'');
 const [promoActive, setPromoActive] = useState(siteSettings.promoBannerEnabled || false);
 const [orderTrackerEnabled, setOrderTrackerEnabled] = useState(siteSettings.orderTrackerEnabled ?? true);
 const [orderTrackerInNavbar, setOrderTrackerInNavbar] = useState(siteSettings.orderTrackerInNavbar ?? false);
 const [promoTextVal, setPromoTextVal] = useState(siteSettings.promoBannerText ||'');
 const [socialFB, setSocialFB] = useState(siteSettings.socialFacebook ??'');
 const [socialIG, setSocialIG] = useState(siteSettings.socialInstagram ??'');
 const [socialTW, setSocialTW] = useState(siteSettings.socialTwitter ??'');
 const [newsletterIconUrl, setNewsletterIconUrl] = useState(siteSettings.newsletterSectionIcon ??'');
 const [testimonialIconUrl, setTestimonialIconUrl] = useState(siteSettings.testimonialSectionIcon ??'');
 const [faviconUrl, setFaviconUrl] = useState(siteSettings.faviconUrl ??'');



 // --- SMTP FORM FIELDS ---
 const [smtpEnabled, setSmtpEnabled] = useState(smtpSettings.isEnabled || false);
 const [smtpHost, setSmtpHost] = useState(smtpSettings.host ||'');
 const [smtpPort, setSmtpPort] = useState(smtpSettings.port ||'');
 const [smtpEmailVal, setSmtpEmailVal] = useState(smtpSettings.email ||'');
 const [smtpPassVal, setSmtpPassVal] = useState(smtpSettings.password ||'');
 const [smtpFromName, setSmtpFromName] = useState(smtpSettings.fromName ||'');
 // OTP config
 const [otpEnabled, setOtpEnabled] = useState(smtpSettings.otpEnabled !== false);
 const [otpExpiryMinutes, setOtpExpiryMinutes] = useState(smtpSettings.otpExpiryMinutes || 10);  const [otpSubject, setOtpSubject] = useState(smtpSettings.otpSubject ||'');
  // Email template config
  const [orderConfirmationSubject, setOrderConfirmationSubject] = useState(smtpSettings.orderConfirmationSubject ||'');
  const [orderConfirmationTemplate, setOrderConfirmationTemplate] = useState(smtpSettings.orderConfirmationTemplate ||'');
  const [orderStatusSubject, setOrderStatusSubject] = useState(smtpSettings.orderStatusSubject ||'');
  const [orderStatusTemplate, setOrderStatusTemplate] = useState(smtpSettings.orderStatusTemplate ||'');
  const [adminOrderNotificationSubject, setAdminOrderNotificationSubject] = useState(smtpSettings.adminOrderNotificationSubject ||'');
  const [adminOrderNotificationTemplate, setAdminOrderNotificationTemplate] = useState(smtpSettings.adminOrderNotificationTemplate ||'');
  const [welcomeSubject, setWelcomeSubject] = useState(smtpSettings.welcomeSubject ||'');
  const [welcomeTemplate, setWelcomeTemplate] = useState(smtpSettings.welcomeTemplate ||'');

  // ─── Cross-device SMTP sync ──────────────────────────────────────────────
  // The local input state above is seeded *once* from smtpSettings. On a
  // fresh device (or after the real-time Firestore/Supabase listener fires)
  // the context's smtpSettings updates *after* this component mounted —
  // without this effect the form keeps showing stale/blank values and
  // re-saving wipes the backend record. This effect re-hydrates every input
  // when the backend-sourced smtpSettings object actually changes identity.
  useEffect(() => {
    if (!smtpSettings) return;
    setSmtpEnabled(smtpSettings.isEnabled || false);
    setSmtpHost(smtpSettings.host || '');
    setSmtpPort(smtpSettings.port || '');
    setSmtpEmailVal(smtpSettings.email || '');
    setSmtpPassVal(smtpSettings.password || '');
    setSmtpFromName(smtpSettings.fromName || '');
    setOtpEnabled(smtpSettings.otpEnabled !== false);
    setOtpExpiryMinutes(smtpSettings.otpExpiryMinutes || 10);
    setOtpSubject(smtpSettings.otpSubject || '');
    setOrderConfirmationSubject(smtpSettings.orderConfirmationSubject || '');
    setOrderConfirmationTemplate(smtpSettings.orderConfirmationTemplate || '');
    setOrderStatusSubject(smtpSettings.orderStatusSubject || '');
    setOrderStatusTemplate(smtpSettings.orderStatusTemplate || '');
    setAdminOrderNotificationSubject(smtpSettings.adminOrderNotificationSubject || '');
    setAdminOrderNotificationTemplate(smtpSettings.adminOrderNotificationTemplate || '');
    setWelcomeSubject(smtpSettings.welcomeSubject || '');
    setWelcomeTemplate(smtpSettings.welcomeTemplate || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smtpSettings]);
  // --- SMS SETTINGS ---
 const [smsEnabled, setSmsEnabled] = useState(smsSettings?.isEnabled || false);
 const [smsAccountSid, setSmsAccountSid] = useState(smsSettings?.accountSid ||'');
 const [smsAuthToken, setSmsAuthToken] = useState(smsSettings?.authToken ||'');
 const [smsFromNumber, setSmsFromNumber] = useState(smsSettings?.fromNumber ||'');
 const [smsOtpEnabled, setSmsOtpEnabled] = useState(smsSettings?.otpEnabled !== false);
 const [smsOtpExpiry, setSmsOtpExpiry] = useState(smsSettings?.otpExpiryMinutes || 10);
 const [smsMsgTemplate, setSmsMsgTemplate] = useState(smsSettings?.otpMessageTemplate ||'{{code}} is your {{store}} verification code. Valid for {{expiry}} min.');
 const [smsTestPhone, setSmsTestPhone] = useState('');
 const [smsTestStatus, setSmsTestStatus] = useState<{ type:'success' |'error' |'loading'; msg: string } | null>(null);
 // --- EMAIL VERIFICATION ---
 const [evEnabled, setEvEnabled] = useState(emailVerificationSettings?.isEnabled || false);
 const [evRequireBeforeOrder, setEvRequireBeforeOrder] = useState(emailVerificationSettings?.requireVerificationBeforeOrder || false);
 const [evTokenExpiry, setEvTokenExpiry] = useState(emailVerificationSettings?.tokenExpiryHours || 24);
 const [evOtpSignIn, setEvOtpSignIn] = useState(emailVerificationSettings?.otpSignInVerification || false);
 const [otpTestEmail, setOtpTestEmail] = useState('');
 const [otpTestStatus, setOtpTestStatus] = useState<{ type:'success' |'error' |'loading'; msg: string } | null>(null);
 // --- PAYMENT GATEWAY TEST CONNECTION ---
 const [gwTestStatus, setGwTestStatus] = useState<Record<string, { type: 'loading'|'success'|'error'; msg: string } | null>>({});
 // --- WHATSAPP SETTINGS ---
 const [waEnabled, setWaEnabled] = useState(false);
 const [waPhoneNumberId, setWaPhoneNumberId] = useState('');
 const [waAccessToken, setWaAccessToken] = useState('');
 const [waTemplateName, setWaTemplateName] = useState('order_status_update');

 // --- PAYMENTS CONFIG FIELDS ---
 const [payCod, setPayCod] = useState(paymentSettings.codEnabled ?? false);
 const [payBkash, setPayBkash] = useState(paymentSettings.bKashEnabled ?? false);
 const [payBkashNo, setPayBkashNo] = useState(paymentSettings.bKashNo ??'');
 const [payBkashGuide, setPayBkashGuide] = useState(paymentSettings.bKashInstructions ??'');
 const [payBkashLogoEmoji, setPayBkashLogoEmoji] = useState(paymentSettings.bKashLogoEmoji ??'');
 const [payBkashQrCodeUrl, setPayBkashQrCodeUrl] = useState(paymentSettings.bKashQrCodeUrl ??'');

 const [payNagad, setPayNagad] = useState(paymentSettings.nagadEnabled ?? false);
 const [payNagadNo, setPayNagadNo] = useState(paymentSettings.nagadNo ??'');
 const [payNagadGuide, setPayNagadGuide] = useState(paymentSettings.nagadInstructions ??'');
 const [payNagadLogoEmoji, setPayNagadLogoEmoji] = useState(paymentSettings.nagadLogoEmoji ??'');
 const [payNagadQrCodeUrl, setPayNagadQrCodeUrl] = useState(paymentSettings.nagadQrCodeUrl ??'');

 const [payRocket, setPayRocket] = useState(paymentSettings.rocketEnabled ?? false);
 const [payRocketNo, setPayRocketNo] = useState(paymentSettings.rocketNo ??'');
 const [payRocketGuide, setPayRocketGuide] = useState(paymentSettings.rocketInstructions ??'');
 const [payRocketLogoEmoji, setPayRocketLogoEmoji] = useState(paymentSettings.rocketLogoEmoji ??'');
 const [payRocketQrCodeUrl, setPayRocketQrCodeUrl] = useState(paymentSettings.rocketQrCodeUrl ??'');

 const [payBank, setPayBank] = useState(paymentSettings.bankEnabled ?? false);
 const [payBankNo, setPayBankNo] = useState(paymentSettings.bankNo ??'');
 const [payBankGuide, setPayBankGuide] = useState(paymentSettings.bankInstructions ??'');
 const [payBankLogoEmoji, setPayBankLogoEmoji] = useState(paymentSettings.bankLogoEmoji ??'');
 const [payBankQrCodeUrl, setPayBankQrCodeUrl] = useState(paymentSettings.bankQrCodeUrl ??'');
 const [payBankName, setPayBankName] = useState(paymentSettings.bankName ??'');
 const [payBankHolder, setPayBankHolder] = useState(paymentSettings.bankHolder ??'');

 const [payCreditManual, setPayCreditManual] = useState(paymentSettings.creditManualEnabled ?? false);
 const [payCreditManualNo, setPayCreditManualNo] = useState(paymentSettings.creditManualNo ??'');
 const [payCreditManualGuide, setPayCreditManualGuide] = useState(paymentSettings.creditManualInstructions ??'');
 const [payCreditManualLogoEmoji, setPayCreditManualLogoEmoji] = useState(paymentSettings.creditManualLogoEmoji ??'');
 const [payCreditManualQrCodeUrl, setPayCreditManualQrCodeUrl] = useState(paymentSettings.creditManualQrCodeUrl ??'');

 const [payStripe, setPayStripe] = useState(paymentSettings.stripeEnabled ?? false);
 const [payStripeKey, setPayStripeKey] = useState(paymentSettings.stripePublicKey ??'');
 const [payStripeSecret, setPayStripeSecret] = useState(paymentSettings.stripeSecretKey ??'');
 const [payStripeSandbox, setPayStripeSandbox] = useState(paymentSettings.stripeSandboxMode ?? false);

 const [payPaypal, setPayPaypal] = useState(paymentSettings.paypalEnabled ?? false);
 const [payPaypalClientId, setPayPaypalClientId] = useState(paymentSettings.paypalClientId ??'');
 const [payPaypalClientSecret, setPayPaypalClientSecret] = useState(paymentSettings.paypalClientSecret ??'');
 const [payPaypalSandbox, setPayPaypalSandbox] = useState(paymentSettings.paypalSandboxMode ?? true);

 const [payBkashAuto, setPayBkashAuto] = useState(paymentSettings.bKashAutoEnabled ?? false);
 const [payBkashAppKey, setPayBkashAppKey] = useState(paymentSettings.bKashAppKey ??'');
 const [payBkashAppSecret, setPayBkashAppSecret] = useState(paymentSettings.bKashAppSecret ??'');
 const [payBkashUsername, setPayBkashUsername] = useState(paymentSettings.bKashUsername ??'');
 const [payBkashPassword, setPayBkashPassword] = useState(paymentSettings.bKashPassword ??'');
 const [payBkashSandbox, setPayBkashSandbox] = useState(paymentSettings.bKashSandboxMode ?? true);

 // --- PAYMENT METHOD BRANDING ---
 // Defaults are empty string — no text shows by default, only the logo. Admin can type a name to show one.
 const [brandCodName, setBrandCodName] = useState(paymentSettings.codDisplayName ??'');
 const [brandCodLogo, setBrandCodLogo] = useState(paymentSettings.codLogoImageUrl ??'');
 const [brandBkashName, setBrandBkashName] = useState(paymentSettings.bKashDisplayName ??'');
 const [brandBkashLogo, setBrandBkashLogo] = useState(paymentSettings.bKashLogoImageUrl ??'');
 const [brandNagadName, setBrandNagadName] = useState(paymentSettings.nagadDisplayName ??'');
 const [brandNagadLogo, setBrandNagadLogo] = useState(paymentSettings.nagadLogoImageUrl ??'');
 const [brandRocketName, setBrandRocketName] = useState(paymentSettings.rocketDisplayName ??'');
 const [brandRocketLogo, setBrandRocketLogo] = useState(paymentSettings.rocketLogoImageUrl ??'');
 const [brandBankName, setBrandBankName] = useState(paymentSettings.bankDisplayName ??'');
 const [brandBankLogo, setBrandBankLogo] = useState(paymentSettings.bankLogoImageUrl ??'');
 const [brandCreditManualName, setBrandCreditManualName] = useState(paymentSettings.creditManualDisplayName ??'');
 const [brandCreditManualLogo, setBrandCreditManualLogo] = useState(paymentSettings.creditManualLogoImageUrl ??'');
 const [brandPaypalName, setBrandPaypalName] = useState(paymentSettings.paypalDisplayName ??'');
 const [brandPaypalLogo, setBrandPaypalLogo] = useState(paymentSettings.paypalLogoImageUrl ??'');
 const [brandStripeName, setBrandStripeName] = useState(paymentSettings.stripeDisplayName ??'');
 const [brandStripeLogo, setBrandStripeLogo] = useState(paymentSettings.stripeLogoImageUrl ??'');
 const [brandBkashAutoName, setBrandBkashAutoName] = useState(paymentSettings.bKashAutoDisplayName ??'');
 const [brandBkashAutoLogo, setBrandBkashAutoLogo] = useState(paymentSettings.bKashAutoLogoImageUrl ??'');
 const [brandNagadAutoName, setBrandNagadAutoName] = useState(paymentSettings.nagadAutoDisplayName ??'');
 const [brandNagadAutoLogo, setBrandNagadAutoLogo] = useState(paymentSettings.nagadAutoLogoImageUrl ??'');
 const [brandSslcommerzName, setBrandSslcommerzName] = useState(paymentSettings.sslCommerzDisplayName ??'');
 const [brandSslcommerzLogo, setBrandSslcommerzLogo] = useState(paymentSettings.sslCommerzLogoImageUrl ??'');
const [brandRazorpayName, setBrandRazorpayName] = useState(paymentSettings.razorpayDisplayName ??'');
const [brandRazorpayLogo, setBrandRazorpayLogo] = useState(paymentSettings.razorpayLogoImageUrl ??'');
const [brandPaytmLogo, setBrandPaytmLogo] = useState((paymentSettings as any).paytmLogoImageUrl ?? '');
const [brandUpiLogo, setBrandUpiLogo] = useState((paymentSettings as any).upiLogoImageUrl ?? '');
const [brandJazzCashLogo, setBrandJazzCashLogo] = useState((paymentSettings as any).jazzCashLogoImageUrl ?? '');
const [brandEasypaisaLogo, setBrandEasypaisaLogo] = useState((paymentSettings as any).easypaisaLogoImageUrl ?? '');
const [brandPayFastLogo, setBrandPayFastLogo] = useState((paymentSettings as any).payFastLogoImageUrl ?? '');
 // Optional subtext under each payment button (empty = hidden)
 const [subtextCod, setSubtextCod] = useState(paymentSettings.codSubtext ??'');
 const [subtextBkash, setSubtextBkash] = useState(paymentSettings.bKashSubtext ??'');
 const [subtextNagad, setSubtextNagad] = useState(paymentSettings.nagadSubtext ??'');
 const [subtextRocket, setSubtextRocket] = useState(paymentSettings.rocketSubtext ??'');
 const [subtextBank, setSubtextBank] = useState(paymentSettings.bankSubtext ??'');
 const [subtextCreditManual, setSubtextCreditManual] = useState(paymentSettings.creditManualSubtext ??'');
 const [subtextPaypal, setSubtextPaypal] = useState(paymentSettings.paypalSubtext ??'');
 const [subtextStripe, setSubtextStripe] = useState(paymentSettings.stripeSubtext ??'');
 const [subtextBkashAuto, setSubtextBkashAuto] = useState(paymentSettings.bKashAutoSubtext ??'');
 const [subtextNagadAuto, setSubtextNagadAuto] = useState(paymentSettings.nagadAutoSubtext ??'');
 const [subtextSslcommerz, setSubtextSslcommerz] = useState(paymentSettings.sslCommerzSubtext ??'');
 const [subtextRazorpay, setSubtextRazorpay] = useState(paymentSettings.razorpaySubtext ??'');

 const [payNagadAuto, setPayNagadAuto] = useState(paymentSettings.nagadAutoEnabled ?? false);
 const [payNagadMerchantId, setPayNagadMerchantId] = useState(paymentSettings.nagadMerchantId ??'');
 const [payNagadPrivateKey, setPayNagadPrivateKey] = useState(paymentSettings.nagadMerchantPrivateKey ??'');
 const [payNagadPublicKey, setPayNagadPublicKey] = useState(paymentSettings.nagadPublicKey ??'');
 const [payNagadSandbox, setPayNagadSandbox] = useState(paymentSettings.nagadSandboxMode ?? true);

 const [paySsl, setPaySsl] = useState(paymentSettings.sslCommerzEnabled ?? false);
 const [paySslStoreId, setPaySslStoreId] = useState(paymentSettings.sslCommerzStoreId ??'');
 const [paySslStorePass, setPaySslStorePass] = useState(paymentSettings.sslCommerzStorePassword ??'');
 const [paySslSandbox, setPaySslSandbox] = useState(paymentSettings.sslCommerzSandboxMode ?? false);

 const [payRazor, setPayRazor] = useState(paymentSettings.razorpayEnabled ?? false);
 const [payRazorKeyId, setPayRazorKeyId] = useState(paymentSettings.razorpayKeyId ??'');
 const [payRazorKeySecret, setPayRazorKeySecret] = useState(paymentSettings.razorpayKeySecret ??'');
 const [payRazorSandbox, setPayRazorSandbox] = useState(paymentSettings.razorpaySandboxMode ?? false);

 // ── NEW CHECKOUT CHANNELS (v5.7): Paytm, UPI, JazzCash, Easypaisa, PayFast ──
 const [payPaytm, setPayPaytm] = useState(paymentSettings.paytmEnabled ?? false);
 const [payPaytmMid, setPayPaytmMid] = useState(paymentSettings.paytmMerchantId ?? '');
 const [payPaytmKey, setPayPaytmKey] = useState(paymentSettings.paytmMerchantKey ?? '');
 const [payPaytmSandbox, setPayPaytmSandbox] = useState(paymentSettings.paytmSandboxMode ?? true);

 const [payUpi, setPayUpi] = useState(paymentSettings.upiManualEnabled ?? false);
 const [payUpiId, setPayUpiId] = useState(paymentSettings.upiId ?? '');
 const [payUpiName, setPayUpiName] = useState(paymentSettings.upiPayeeName ?? '');
 const [payUpiQr, setPayUpiQr] = useState(paymentSettings.upiQrCodeUrl ?? '');
 const [payUpiInstr, setPayUpiInstr] = useState(paymentSettings.upiInstructions ?? '');

 const [payJazz, setPayJazz] = useState(paymentSettings.jazzCashEnabled ?? false);
 const [payJazzMid, setPayJazzMid] = useState(paymentSettings.jazzCashMerchantId ?? '');
 const [payJazzPwd, setPayJazzPwd] = useState(paymentSettings.jazzCashPassword ?? '');
 const [payJazzSalt, setPayJazzSalt] = useState(paymentSettings.jazzCashIntegritySalt ?? '');
 const [payJazzSandbox, setPayJazzSandbox] = useState(paymentSettings.jazzCashSandboxMode ?? true);

 const [payEasy, setPayEasy] = useState(paymentSettings.easypaisaEnabled ?? false);
 const [payEasyStore, setPayEasyStore] = useState(paymentSettings.easypaisaStoreId ?? '');
 const [payEasyHash, setPayEasyHash] = useState(paymentSettings.easypaisaHashKey ?? '');
 const [payEasySandbox, setPayEasySandbox] = useState(paymentSettings.easypaisaSandboxMode ?? true);

 const [payPf, setPayPf] = useState(paymentSettings.payFastEnabled ?? false);
 const [payPfMid, setPayPfMid] = useState(paymentSettings.payFastMerchantId ?? '');
 const [payPfKey, setPayPfKey] = useState(paymentSettings.payFastMerchantKey ?? '');
 const [payPfPass, setPayPfPass] = useState(paymentSettings.payFastPassphrase ?? '');
 const [payPfSandbox, setPayPfSandbox] = useState(paymentSettings.payFastSandboxMode ?? true);

 const [payFee, setPayFee] = useState(paymentSettings.shippingFee ?? 5);
 const [payTax, setPayTax] = useState(paymentSettings.taxPercentage ?? 0);


 // --- CHAT SUPPORT FIELDS ---
 const [supportEnabled, setSupportEnabled] = useState(supportSettings.isEnabled || false);
 const [supportId, setSupportId] = useState(supportSettings.tawkToId ||'');

 // --- SECURITY AUTHENTICATION FORM ---
 const [secUsername, setSecUsername] = useState(adminSettings.username ||'');
 const [secPass, setSecPass] = useState('');
 const [showSecPass, setShowSecPass] = useState(false);

 // --- GOOGLE SIGN-IN SETTINGS ---
 const [googleSignInEnabled, setGoogleSignInEnabled] = useState(adminSettings.googleSignInEnabled ?? false);
 const [googleClientId, setGoogleClientId] = useState(adminSettings.googleClientId ||'');
 const [recaptchaEnabled, setRecaptchaEnabled] = useState(adminSettings.recaptchaEnabled ?? false);
 const [recaptchaSiteKey, setRecaptchaSiteKey] = useState(adminSettings.recaptchaSiteKey || '');

 // Helper: record a failed login attempt and apply lockout if threshold reached
 const recordFailedAttempt = () => {
   const newCount = loginAttemptCount + 1;
   setLoginAttemptCount(newCount);
   if (newCount >= MAX_ATTEMPTS) {
     const until = Date.now() + LOCKOUT_MS;
     setLockoutUntil(until);
     try { localStorage.setItem(LOCKOUT_KEY, JSON.stringify({ count: newCount, until })); } catch {}
     setLoginError(`Too many failed attempts. Account locked for 15 minutes.`);
   } else {
     try { localStorage.setItem(LOCKOUT_KEY, JSON.stringify({ count: newCount, until: null })); } catch {}
     const remaining = MAX_ATTEMPTS - newCount;
     setLoginError(`Invalid credentials. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining before lockout.`);
   }
 };

 const handleAdminVerify = async (e: React.FormEvent) => {
 e.preventDefault();
 setLoginError('');
 setLoginSuccess('');
 // --- LOCKOUT CHECK ---
 if (lockoutUntil && Date.now() < lockoutUntil) {
   const mins = Math.ceil((lockoutUntil - Date.now()) / 60000);
   setLoginError(`Account locked. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.`);
   return;
 }
 setLoginLoading(true);
 try {
   const inputUser = usernameInput.trim();
   const inputPass = passwordInput.trim();

   // ── Load stored settings (email, username, hashed password).
   //    localStorage is fast and works in the same browser; Firestore works
   //    cross-device as long as Firestore rules are deployed.
   let liveSettings = { ...adminSettings } as any;
   try {
     const raw = localStorage.getItem('qf_adminSettings');
     if (raw) {
       const parsed = JSON.parse(raw);
       if (parsed?.username) liveSettings = parsed;
     }
   } catch {}
   if (!liveSettings?.email) {
     try { liveSettings = await dbService.getAdminSettings(); } catch {}
   }

    // Always verify the actual saved admin username + password hash.
    // Firebase/Supabase connection alone must never bypass the password check.
    const storedPass = liveSettings?.password || liveSettings?.passwordHash || adminSettings.password || adminSettings.passwordHash || '';
   const storedUser = liveSettings?.username || adminSettings.username || '';

   // If we couldn't load credentials from ANY source, show a helpful error
   // instead of silently failing with 'Invalid credentials'.
   if (!storedUser && !storedPass) {
     const engine = getActiveEngine();
     let hint = '';
     if (engine === 'supabase') {
       hint = ' Make sure SUPABASE_URL and SUPABASE_ANON_KEY are set on your server, or run the installer from this browser first.';
     } else if (engine === 'firebase') {
       hint = ' Make sure FIREBASE_* environment variables are set on your server, or run the installer from this browser first.';
     }
     setLoginError('Could not load admin credentials from the database.' + hint);
     setLoginLoading(false);
     return;
   }
   const newHash = await hashPassword(inputPass);
   const oldHash = simpleHash(inputPass);
   const passMatches =
     newHash === storedPass ||
     oldHash === storedPass ||
     inputPass === storedPass;

   if (inputUser === storedUser && passMatches) {
     setLoginAttemptCount(0); setLockoutUntil(null); try { localStorage.removeItem(LOCKOUT_KEY); } catch {}
     setLoginSuccess('Access granted! Loading Store Admin...');
     if (oldHash === storedPass || inputPass === storedPass) {
       await saveAdminSettings({ ...liveSettings, username: storedUser, password: newHash });
       try { localStorage.setItem('qf_adminSettings', JSON.stringify({ ...liveSettings, username: storedUser, password: newHash })); } catch {}
     }
     setTimeout(() => { setAdminLoggedIn(true, inputUser, inputPass); }, 900);
   } else {
     recordFailedAttempt();
   }
 } finally {
   setLoginLoading(false);
 }
 };

 
// --- EXPORT PRODUCTS CSV ---
const exportProductsCSV = () => {
  const esc = (val: string | number | null | undefined) => `"${String(val ?? '').replace(/"/g, '""')}"`;
  const headers = ['name','category','description','price','salePrice','stock','image','featured'];
  const rows = products.map(p => [
    esc(p.name), esc(p.category), esc(p.description), esc(p.price),
    esc(p.salePrice ?? ''), esc(p.stock), esc(p.image), esc(String(p.isFeatured ?? false)),
  ].join(','));
  const csv = [headers.map(h => `"${h}"`).join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `products_export_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`Exported ${products.length} product${products.length !== 1 ? 's' : ''} to CSV.`);
};

// --- FULL DATA EXPORT (Firebase → Supabase migration) ---
const exportAllDataJSON = async () => {
  try {
    // Fetch gallery images + variants for every product
    const allImages: any[] = [];
    const allVarGroups: any[] = [];
    const allVariants: any[] = [];
    await Promise.all(products.map(async (p) => {
      const [imgs, groups, vars] = await Promise.all([
        getProductImages(p.id),
        getProductVariantGroups(p.id),
        getProductVariants(p.id),
      ]);
      allImages.push(...imgs);
      allVarGroups.push(...groups);
      allVariants.push(...vars);
    }));

    const data = {
      _meta: {
        exportedAt: new Date().toISOString(),
        engine: databaseEngine,
        version: '1.2',
        note: 'Import this file using the Fruitopia import tool on your new site backend.',
      },
      products,
      categories,
      reviews,
      coupons,
      orders,
      subscribers: newsletterSubscribers,
      productImages: allImages,
      variantGroups: allVarGroups,
      productVariants: allVariants,
      // Configuration snapshots — included from v1.2 so a migration carries all settings
      deliveryZones,
      siteSettings,
      paymentSettings,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fruitopia_full_export_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Full data export ready — includes gallery images and variants!');
  } catch (err) {
    toast.error('Export failed. Please try again.');
  }
};


// --- IMPORT ALL DATA FROM JSON (migration from Firebase / Supabase) ---
const [importStatus, setImportStatus] = React.useState<'idle' | 'loading' | 'done' | 'error'>('idle');
const [importLog, setImportLog] = React.useState<string[]>([]);
const [importProgress, setImportProgress] = React.useState<{ done: number; total: number } | null>(null);

const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  setImportStatus('loading');
  setImportLog([]);
  setImportProgress(null);
  const log = (msg: string) => setImportLog(prev => [...prev, msg]);
  try {
    const text = await file.text();
    const data = JSON.parse(text) as any;
    if (!data || typeof data !== 'object') throw new Error('Invalid JSON file — not an object.');
    // Validate it looks like a Fruitopia export
    const knownKey = ['products','categories','reviews','coupons','orders','subscribers'].some(k => Array.isArray(data[k]));
    if (!knownKey) throw new Error('File does not look like a Fruitopia export. Missing required collections.');

    const productList:   any[] = Array.isArray(data.products)    ? data.products    : [];
    const categoryList:  any[] = Array.isArray(data.categories)  ? data.categories  : [];
    const reviewList:    any[] = Array.isArray(data.reviews)     ? data.reviews     : [];
    const couponList:    any[] = Array.isArray(data.coupons)     ? data.coupons     : [];
    const orderList:     any[] = Array.isArray(data.orders)      ? data.orders      : [];
    const subscriberList:any[] = Array.isArray(data.subscribers) ? data.subscribers : [];
    const total = productList.length + categoryList.length + reviewList.length + couponList.length + orderList.length + subscriberList.length;
    setImportProgress({ done: 0, total });
    let done = 0;
    const tick = () => { done++; setImportProgress({ done, total }); };

    // ── Categories first (products reference them) ──
    let catOk = 0, catFail = 0;
    for (const cat of categoryList) {
      try { await addCategory(cat); catOk++; } catch { catFail++; }
      tick();
    }
    if (categoryList.length) log(`Categories: ${catOk} imported${catFail ? `, ${catFail} failed` : ''}.`);

    // ── Products ──
    let prodOk = 0, prodFail = 0;
    for (const prod of productList) {
      try { await addProduct(prod); prodOk++; } catch { prodFail++; }
      tick();
    }
    if (productList.length) log(`Products: ${prodOk} imported${prodFail ? `, ${prodFail} failed` : ''}.`);

    // ── Gallery Images (group by productId, then save) ──
    const imageList: any[] = Array.isArray(data.productImages) ? data.productImages : [];
    if (imageList.length) {
      const byProduct = imageList.reduce((acc: Record<string, any[]>, img: any) => {
        if (!acc[img.productId]) acc[img.productId] = [];
        acc[img.productId].push(img);
        return acc;
      }, {});
      let imgOk = 0, imgFail = 0;
      for (const [pid, imgs] of Object.entries(byProduct)) {
        try { await saveProductImages(pid, imgs as any); imgOk += (imgs as any[]).length; } catch { imgFail++; }
      }
      log(`Gallery images: ${imgOk} imported${imgFail ? `, ${imgFail} failed` : ''}.`);
    }

    // ── Variant Groups (group by productId) ──
    const varGroupList: any[] = Array.isArray(data.variantGroups) ? data.variantGroups : [];
    if (varGroupList.length) {
      const byProduct = varGroupList.reduce((acc: Record<string, any[]>, g: any) => {
        if (!acc[g.productId]) acc[g.productId] = [];
        acc[g.productId].push(g);
        return acc;
      }, {});
      let vgOk = 0, vgFail = 0;
      for (const [pid, groups] of Object.entries(byProduct)) {
        try { await saveProductVariantGroups(pid, groups as any); vgOk += (groups as any[]).length; } catch { vgFail++; }
      }
      log(`Variant groups: ${vgOk} imported${vgFail ? `, ${vgFail} failed` : ''}.`);
    }

    // ── Product Variants (group by productId) ──
    const variantList: any[] = Array.isArray(data.productVariants) ? data.productVariants : [];
    if (variantList.length) {
      const byProduct = variantList.reduce((acc: Record<string, any[]>, v: any) => {
        if (!acc[v.productId]) acc[v.productId] = [];
        acc[v.productId].push(v);
        return acc;
      }, {});
      let varOk = 0, varFail = 0;
      for (const [pid, vars] of Object.entries(byProduct)) {
        try { await saveProductVariants(pid, vars as any); varOk += (vars as any[]).length; } catch { varFail++; }
      }
      log(`Product variants: ${varOk} imported${varFail ? `, ${varFail} failed` : ''}.`);
    }

    // ── Coupons ──
    let coupOk = 0, coupFail = 0;
    for (const coup of couponList) {
      try { await addCoupon(coup); coupOk++; } catch { coupFail++; }
      tick();
    }
    if (couponList.length) log(`Coupons: ${coupOk} imported${coupFail ? `, ${coupFail} failed` : ''}.`);

    // ── Orders (direct dbService to preserve full order data + IDs) ──
    let ordOk = 0, ordFail = 0;
    for (const ord of orderList) {
      try { await dbService.saveOrder(ord); ordOk++; } catch { ordFail++; }
      tick();
    }
    if (orderList.length) log(`Orders: ${ordOk} imported${ordFail ? `, ${ordFail} failed` : ''}.`);

    // ── Reviews (preserve content; newly-approved reviews get re-approved) ──
    let revOk = 0, revFail = 0;
    for (const rev of reviewList) {
      try {
        await addReview(rev.productId, rev.reviewerName, rev.rating, rev.comment || '');
        revOk++;
      } catch { revFail++; }
      tick();
    }
    if (reviewList.length) log(`Reviews: ${revOk} imported${revFail ? `, ${revFail} failed` : ''} (pending approval).`);

    // ── Subscribers (by email via subscribeNewsletter) ──
    let subOk = 0, subFail = 0;
    for (const sub of subscriberList) {
      if (!sub.email) { subFail++; tick(); continue; }
      try { await dbService.subscribeNewsletter(sub.email); subOk++; } catch { subFail++; }
      tick();
    }
    if (subscriberList.length) log(`Subscribers: ${subOk} imported${subFail ? `, ${subFail} skipped (duplicates or invalid)` : ''}.`);

    setImportStatus('done');
    toast.success(`Import complete! ${done} records loaded into your ${databaseEngine} database.`);
  } catch (err: any) {
    setImportStatus('error');
    setImportLog(prev => [...prev, `Error: ${err?.message || 'Unknown error'}`]);
    toast.error('Import failed — see log below.');
  }
};

const handleLogout = () => {
 setAdminLoggedIn(false);
 toast.info('Logged out of admin panel.');
 };

 // --- TASK 12: EXPORT ORDERS CSV ---
 const exportOrdersCSV = (filteredOrders: typeof orders) => {
 const esc = (val: string | number | null | undefined) => {
 const s = String(val ??'').replace(/"/g,'""');
 return`"${s}"`;
 };
 const headers = [
'Order#','Date','Customer','Email','Phone','City',
'Items','Subtotal','Discount','Delivery','Total',
'Payment Method','Payment Status','Order Status',
 ];
 const rows = filteredOrders.map(o => [
 esc(o.orderNumber),
 esc(new Date(o.createdAt).toLocaleDateString()),
 esc(o.customerName),
 esc(o.email),
 esc(o.phone),
 esc(o.city),
 esc(o.items.map(i =>`${i.name} x${i.quantity}`).join(' |')),
 esc(o.subtotal),
 esc(o.discount),
 esc(o.deliveryFee),
 esc(o.total),
 esc(o.paymentMethod),
 esc(o.paymentStatus),
 esc(o.orderStatus),
 ].join(','));
 const csv = [headers.map(h =>`"${h}"`).join(','), ...rows].join('\n');
 const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download =`orders_export_${new Date().toISOString().split('T')[0]}.csv`;
 document.body.appendChild(a);
 a.click();
 document.body.removeChild(a);
 URL.revokeObjectURL(url);
 toast.success(`Exported ${filteredOrders.length} orders to CSV.`);
 };

 // --- CRUD: PRODUCT SAVE ---
 const handleOpenProductForm = (prod: Product | null = null) => {
 setProdImageUploadError('');
 if (prod) {
 setEditingProduct(prod);
 setProdName(prod.name);
 setProdDesc(prod.description);
 setProdPrice(prod.price);
 setProdSalePrice(prod.salePrice);
 setProdStock(prod.stock);
      // Use coverImage (primary) if set, fall back to legacy image field
      const activeImage = prod.coverImage || prod.image;
      setProdImage(activeImage);
 setProdCategory(prod.category);
 setProdFeatured(prod.isFeatured);
 // Detect existing image type
 const isUrl = activeImage.startsWith('http') || activeImage.startsWith('data:') || activeImage.startsWith('/');
 setProdImageMode(isUrl ?'url' :'emoji');
      setProdImagePreview(isUrl ? activeImage : '');
  // Load gallery images and variants for this product
  setGalleryImages([]);
  setVariantGroups([]);
  setVariantRows([]);
  setNewGroupName('');
  setNewVariantInput({});
  getProductImages(prod.id).then(imgs => setGalleryImages(imgs)).catch(() => {});
  // Resolve productMode: respect explicit field, otherwise infer from
  // whether the product actually has variant rows in the database.
  if (prod.productMode === 'single' || prod.productMode === 'variant') {
    setProductMode(prod.productMode);
  } else {
    setProductMode('single'); // optimistic default while async load runs
  }
  Promise.all([
    getProductVariantGroups(prod.id).catch(() => [] as ProductVariantGroup[]),
    getProductVariants(prod.id).catch(() => [] as ProductVariant[]),
  ]).then(([gs, vs]) => {
    setVariantGroups(gs);
    setVariantRows(vs);
    if (!prod.productMode && vs.length > 0) setProductMode('variant');
  });
  } else {
  setEditingProduct(null);
  setProdName('');
  setProdDesc('');
  setProdPrice(0);
  setProdSalePrice(null);
  setProdStock(50);
       setProdImage('🥝');
  setProdImageMode('emoji');
  setProdImagePreview('');
  setProdCategory(categories[0]?.name ||'');
  setProdFeatured(false);
  // Clear gallery and variants for new product
  setGalleryImages([]);
  setVariantGroups([]);
  setVariantRows([]);
  setNewGroupName('');
  setNewVariantInput({});
  setProductMode('single');
  }
  setIsProductFormOpen(true);
  };

 // --- IMAGE FILE UPLOAD HANDLER ---
 const handleImageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
 const file = e.target.files?.[0];
 setProdImageUploadError('');
 if (!file) return;

 const validation = validateImageFile(file, 2);
 if (!validation.valid) {
 setProdImageUploadError(validation.error || 'Image validation failed.');
 return;
 }

 fileToBase64(file)
 .then((base64String) => {
 setProdImage(base64String);
 setProdImagePreview(base64String);
 })
 .catch((err) => {
 setProdImageUploadError('Failed to encode image. ' + (err?.message || ''));
 });
 };

 // --- PAYMENT LOGO FILE UPLOAD HANDLER ---
 const handlePaymentLogoUpload = (file: File, setLogo: (url: string) => void, onError?: (msg: string) => void) => {
   const validation = validateImageFile(file, 3);
   if (!validation.valid) { onError?.(validation.error || 'Image validation failed.'); return; }
   fileToBase64(file)
     .then((b64) => setLogo(b64))
     .catch((err) => onError?.('Failed to encode image. ' + (err?.message || '')));
 };

 // --- FAVICON FILE UPLOAD HANDLER ---
 const handleFaviconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
   const file = e.target.files?.[0];
   if (!file) return;
   const validation = validateImageFile(file, 1);
   if (!validation.valid) { toast.error(validation.error || 'Invalid image.'); return; }
   fileToBase64(file).then((b64) => setFaviconUrl(b64)).catch(() => toast.error('Failed to read image.'));
 };

 // --- SITE LOGO FILE UPLOAD HANDLER ---
 const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
 const file = e.target.files?.[0];
 setBrandLogoUploadError('');
 if (!file) return;

 const validation = validateImageFile(file, 2);
 if (!validation.valid) {
 setBrandLogoUploadError(validation.error || 'Image validation failed.');
 return;
 }

 fileToBase64(file)
 .then((base64String) => {
 setBrandLogoUrl(base64String);
 setBrandLogoPreview(base64String);
 })
 .catch((err) => {
 setBrandLogoUploadError('Failed to encode image. ' + (err?.message || ''));
 });
 };

 const handleSaveProduct = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!prodName.trim() || !prodCategory) {
 toast.error('Product title name and category are required fields.');
 return;
 }

 try {
 const targetId = editingProduct ? editingProduct.id :'prod_' + Math.random().toString(36).substr(2, 9);
  // When the admin saves a "variant" product, the headline price/stock on
  // the Product card are derived from the cheapest in-stock variant so the
  // listing still shows a meaningful number. Pure single products keep the
  // values the admin typed in the form.
  const effectivePrice = productMode === 'variant' && variantRows.length > 0
    ? Math.min(...variantRows.map(v => v.price).filter(p => p > 0))
    : Number(prodPrice);
  const effectiveStock = productMode === 'variant' && variantRows.length > 0
    ? variantRows.reduce((sum, v) => sum + (v.stock || 0), 0)
    : Number(prodStock);
  const productObj: Product = {
  id: targetId,
  name: prodName.trim(),
  description: prodDesc.trim(),
  price: effectivePrice,
  salePrice: prodSalePrice === null ? null : Number(prodSalePrice),
  stock: effectiveStock,
  image: prodImage.trim(),
  coverImage: prodImage.trim(), // Keep coverImage in sync with image field
  category: prodCategory,
  rating: editingProduct ? editingProduct.rating : 4.8,
  reviewsCount: editingProduct ? editingProduct.reviewsCount : 1,
  isFeatured: prodFeatured,
  isActive: true,
  productMode,
  };

  if (editingProduct) {
   await editProduct(productObj);
 } else {
   await addProduct(productObj);
 }
  // Save gallery images
  await saveProductImages(targetId, galleryImages.map((img, i) => ({ ...img, productId: targetId, sortOrder: i })));
  // Variant data is only relevant in 'variant' mode. In 'single' mode we
  // wipe any stale rows so a product that was switched back from variant
  // to single doesn't keep showing ghost options on the storefront.
  if (productMode === 'variant') {
    await saveProductVariantGroups(targetId, variantGroups.map(g => ({ ...g, productId: targetId })));
    await saveProductVariants(targetId, variantRows.map(v => ({ ...v, productId: targetId })));
  } else {
    await saveProductVariantGroups(targetId, []);
    await saveProductVariants(targetId, []);
  }
 toast.success(editingProduct ? `Updated "${prodName}" successfully.` : `Added "${prodName}" to catalog.`);
 setIsProductFormOpen(false);
 } catch (err) {
 toast.error('Could not save product. Please try again.');
 }
 };

 const handleDeleteProduct = async (id: string, name: string) => {
 triggerConfirm(
'Permanent Product Deletion',
`Are you absolutely sure you want to permanently delete "${name}" from listings? This listing will be immediately wiped from the store catalog.`,
 async () => {
 await deleteProduct(id);
 toast.info(`Deleted "${name}" from listings.`);
 }
 );
 };

 // --- CSV BULK IMPORT ---
 const downloadCsvTemplate = () => {
   const header = 'name,category,description,price,salePrice,stock,image,featured';
   const example = '"Mango Smoothie","Smoothies","Fresh tropical mango blend",4.99,3.99,50,🥭,false';
   const blob = new Blob([header + '\n' + example], { type: 'text/csv' });
   const url = URL.createObjectURL(blob);
   const a = document.createElement('a');
   a.href = url; a.download = 'fruitopia-products-template.csv'; a.click();
   URL.revokeObjectURL(url);
 };

 const handleBulkCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
   const file = e.target.files?.[0];
   e.target.value = '';
   if (!file) return;
   setCsvImporting(true);
   setCsvResults(null);
   const text = await file.text();
   const lines = text.split(/\r?\n/).filter(l => l.trim());
   if (lines.length < 2) {
     toast.error('CSV must have a header row and at least one product row.');
     setCsvImporting(false);
     return;
   }
   // Parse header
   const parseRow = (line: string): string[] => {
     const result: string[] = [];
     let inQuote = false, cur = '';
     for (const ch of line) {
       if (ch === '"') { inQuote = !inQuote; }
       else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
       else { cur += ch; }
     }
     result.push(cur.trim());
     return result;
   };
   const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
   const idx = (key: string) => headers.indexOf(key);
   let imported = 0, failed = 0;
   const errors: string[] = [];
   for (let i = 1; i < lines.length; i++) {
     if (!lines[i].trim()) continue;
     const cols = parseRow(lines[i]);
     const name = cols[idx('name')]?.replace(/^"|"$/g, '') || '';
     const category = cols[idx('category')]?.replace(/^"|"$/g, '') || (categories[0]?.name || '');
     if (!name) { errors.push(`Row ${i + 1}: missing name`); failed++; continue; }
     const priceRaw = parseFloat(cols[idx('price')] || '0');
     const salePriceRaw = cols[idx('saleprice')] ? parseFloat(cols[idx('saleprice')]) : null;
     const stockRaw = parseInt(cols[idx('stock')] || '50', 10);
     const image = cols[idx('image')]?.replace(/^"|"$/g, '') || '🍎';
     const featured = (cols[idx('featured')] || '').toLowerCase() === 'true';
     const product: Product = {
       id: 'prod_' + Math.random().toString(36).substr(2, 9),
       name: name.trim(),
       description: (cols[idx('description')]?.replace(/^"|"$/g, '') || '').trim(),
       price: isNaN(priceRaw) ? 0 : priceRaw,
       salePrice: salePriceRaw !== null && !isNaN(salePriceRaw) ? salePriceRaw : null,
       stock: isNaN(stockRaw) ? 50 : stockRaw,
       image,
       category,
       rating: 4.8,
       reviewsCount: 1,
       isFeatured: featured,
       isActive: true,
     };
     try {
       await addProduct(product);
       imported++;
     } catch (err: any) {
       errors.push(`Row ${i + 1} "${name}": ${err?.message || 'save failed'}`);
       failed++;
     }
   }
   setCsvResults({ imported, failed, errors });
   setCsvImporting(false);
   if (imported > 0) toast.success(`Imported ${imported} product${imported !== 1 ? 's' : ''} successfully.`);
   if (failed > 0) toast.error(`${failed} row${failed !== 1 ? 's' : ''} failed — see import summary below.`);
 };

 // --- CRUD: QUICK CATEGORY SAVE ---
 const handleCreateCategory = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!newCatName.trim()) return;
 try {
 const catObj: Category = {
 id:'cat_' + Math.random().toString(36).substr(2, 9),
 name: newCatName.trim(),
        emoji: newCatImageMode === 'emoji' ? newCatEmoji : '🏷️',
 slug: newCatName.toLowerCase().trim().replace(/\s+/g,'-'),
 isVisible: true,
 isNavbarFeatured: false,
 imageUrl: newCatImageMode ==='picture' ? (newCatImageUrl.trim() || undefined) : undefined,
 };
 await addCategory(catObj);
 toast.success(`Category "${newCatName}" created.`);
      setNewCatName(''); setNewCatEmoji('🏷️'); setNewCatImageUrl(''); setNewCatImageMode('emoji');
 if (!prodCategory) setProdCategory(catObj.name);
 } catch (err) {
 toast.error('Category write failure.');
 }
 };

 const handleDeleteCategory = async (id: string, name: string) => {
 triggerConfirm(
'Category Deletion Warning',
`Delete category "${name}"? Products mapped to this won't change but the navigation filter option will be removed.`,
 async () => {
 await deleteCategory(id);
 toast.info(`Deleted "${name}" category mappings.`);
 }
 );
 };

 const handleStartEditCategory = (cat: { id: string; name: string; emoji: string; imageUrl?: string }) => {
 setEditingCatId(cat.id);
 setEditCatName(cat.name);
    setEditCatEmoji(cat.emoji);
 setEditCatImageUrl(cat.imageUrl ||'');
 setEditCatImageMode(cat.imageUrl ?'picture' :'emoji');
 };

 const handleSaveEditCategory = async (cat: import('../types').Category) => {
 if (!editCatName.trim()) return;
 try {
 const updated: import('../types').Category = {
 ...cat,
 name: editCatName.trim(),
        emoji: editCatImageMode === 'emoji' ? editCatEmoji : cat.emoji,
 slug: editCatName.toLowerCase().trim().replace(/\s+/g,'-'),
 imageUrl: editCatImageMode ==='picture' ? (editCatImageUrl.trim() || undefined) : undefined,
 };
 await editCategory(updated);
      toast.success(`Updated category: ${updated.emoji} ${updated.name}`);
 setEditingCatId(null);
 } catch (err) {
 toast.error('Category update failure.');
 }
 };

 const handleToggleCategoryVisibility = async (cat: import('../types').Category) => {
 try {
 const updated: import('../types').Category = { ...cat, isVisible: !cat.isVisible };
 await editCategory(updated);
 toast.info(`Category"${cat.name}" ${updated.isVisible ?'shown' :'hidden'} on storefront.`);
 } catch (err) {
 toast.error('Visibility toggle failure.');
 }
 };

 const handleToggleNavbarFeatured = async (cat: import('../types').Category) => {
 try {
 const updated: import('../types').Category = { ...cat, isNavbarFeatured: !cat.isNavbarFeatured };
 await editCategory(updated);
 toast.info(`Category"${cat.name}" ${updated.isNavbarFeatured ?'pinned to navbar' :'unpinned from navbar'}.`);
 } catch (err) {
 toast.error('Navbar pin toggle failure.');
 }
 };



 // --- CRUD: COUPONS ---
 const handleCreateCoupon = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!coupCode.trim() || coupDiscount <= 0) return;

 let isLoading = true;
 try {
 const coup: Coupon = {
 id: 'coupon_' + Math.random().toString(36).substr(2, 9),
 code: coupCode.toUpperCase().trim(),
 discountPercentage: Number(coupDiscount),
 expiryDate: coupExpiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
 usageLimit: Number(coupLimit),
 usedCount: 0,
 isActive: true,
 };

 // Write to Firestore first — DO NOT call addCoupon() yet
 // The AppContext will auto-update via onCouponsChange listener
 if (getIsFirebaseConfigured()) {
 await dbService.saveCoupon(coup);
 } else {
 // Fallback: use local context function for non-Firebase setups
 await addCoupon(coup);
 }

 toast.success(`Coupon "${coup.code}" — ${coup.discountPercentage}% off created.`);
 setCoupCode('');
 setCoupDiscount(10);
 setCoupExpiry('');
 setCoupLimit(50);
 setIsCouponFormOpen(false);
 } catch (err) {
 console.error('[AdminPanel] Coupon save error:', err);
 toast.error('Coupon write failure. ' + (err instanceof Error ? err.message : ''));
 } finally {
 isLoading = false;
 }
 };

 // --- ORDER NUMBER MANIPULATOR ---
 const handleSaveOrderNumber = async (orderId: string) => {
 if (!tempOrderNumber.trim()) return;
 try {
 await editOrderNumber(orderId, tempOrderNumber.trim());
 toast.success(`Order suffix changed to"${tempOrderNumber.trim()}" successfully.`);
 setSelectedOrderIdToEdit(null);
 } catch (err) {
 toast.error('Order edit failure.');
 }
 };

 // --- CMS GLOBAL CONFIG SAVER ---
 const handleSaveBrandingCMS = async () => {
 try {
 const current = {
 ...siteSettings,
 websiteName: brandName,
 siteTitle: siteTitle,
 logoUrl: brandLogoUrl,
 logoEmoji:'',
 heroBadge: heroBadgeText,
 heroTitleLine1: heroLine1,
 heroTitleLine2: heroLine2,
 heroSubtitle: heroSubText,
 heroButtonText: heroBtnText,
 heroTimeBadge: heroHours,
 footerText: footerCopy,
 contactPhone: footerPhone,
 contactEmail: footerMail,
 contactAddress: footerLoc,
 trademarkText: trademarkTextVal,
 promoBannerEnabled: promoActive,
 orderTrackerEnabled: orderTrackerEnabled,
 orderTrackerInNavbar: orderTrackerInNavbar,
 maintenanceMode: false,
 maintenanceTitle: '',
 maintenanceMessage: '',
 promoBannerText: promoTextVal,
 socialFacebook: socialFB,
 socialInstagram: socialIG,
 socialTwitter: socialTW,
 newsletterSectionIcon: newsletterIconUrl,
 testimonialSectionIcon: testimonialIconUrl,
 faviconUrl: faviconUrl,
 currency: selectedCurrency,
 currencySymbol: customSymbol,
 currencyPosition: currencyPosition,
 };
await saveSiteSettings(JSON.parse(JSON.stringify(current)));
 showSavedBanner('branding');
 } catch (err) {
 toast.error('Branding CMS update failure.');
 }
 };  const handleSaveSMTPCMS = async () => {
  try {
  const current = {
  isEnabled: smtpEnabled,
  host: smtpHost,
  port: smtpPort,
  email: smtpEmailVal,
  password: smtpPassVal,
  fromName: smtpFromName,
  otpEnabled,
  otpExpiryMinutes,
  otpSubject,
  orderConfirmationSubject,
  orderConfirmationTemplate,
  orderStatusSubject,
  orderStatusTemplate,
  adminOrderNotificationSubject,
  adminOrderNotificationTemplate,
  welcomeSubject,
  welcomeTemplate,
  };
 await saveSMTPSettings(current);
 showSavedBanner('smtp');
 } catch (err) {
 toast.error('SMTP CMS update failure.');
 }
 };

 const handleTestGateway = async (gateway: string, credentials: Record<string, string>) => {
   setGwTestStatus(prev => ({ ...prev, [gateway]: { type: 'loading', msg: 'Testing connection…' } }));
   try {
     // Use /api/<gateway>/test-connection so Vercel rewrites route it correctly
     // (e.g. /api/sslcommerz/test-connection → /api/payment?gateway=sslcommerz&action=test-connection)
     const res = await fetch(`/api/${gateway}/test-connection`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ credentials }),
     });
     const data = await res.json();
     if (data.success) {
       setGwTestStatus(prev => ({ ...prev, [gateway]: { type: 'success', msg: data.message || 'Connection successful!' } }));
     } else {
       setGwTestStatus(prev => ({ ...prev, [gateway]: { type: 'error', msg: data.error || 'Connection failed.' } }));
     }
   } catch (e: any) {
     setGwTestStatus(prev => ({ ...prev, [gateway]: { type: 'error', msg: `Network error: ${e.message}` } }));
   }
 };

 const GwTestBtn: React.FC<{ gw: string; onClick: () => void; label?: string; disabled?: boolean }> = ({ gw, onClick, label = 'Test Connection', disabled }) => {
   const st = gwTestStatus[gw];
   return (
     <div className="mt-2.5 flex flex-wrap items-center gap-2">
       <button
         type="button"
         onClick={onClick}
         disabled={disabled || st?.type === 'loading'}
         className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase border border-slate-300 text-slate-600 bg-white rounded-lg hover:bg-slate-50 hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
       >
         <RefreshCw className={`w-3 h-3 ${st?.type === 'loading' ? 'animate-spin' : ''}`} />
         {st?.type === 'loading' ? 'Testing…' : label}
       </button>
       {st && st.type !== 'loading' && (
         <span className={`text-[10px] font-semibold flex items-center gap-1 ${st.type === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
           {st.type === 'success' ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
           {st.msg}
         </span>
       )}
     </div>
   );
 };

 const handleSendTestOtp = async () => {
 if (!otpTestEmail.trim()) { setOtpTestStatus({ type:'error', msg:'Enter a test email address first.' }); return; }
 setOtpTestStatus({ type:'loading', msg:'Sending test OTP…' });
 const code = String(Math.floor(100000 + Math.random() * 900000));
 const storeName = smtpFromName ||'Your Store';
 const html =`
 <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;background:#f8fafc;border-radius:12px;"> <h2 style="color:#0f172a;margin-bottom:4px;">${storeName} — OTP Test</h2> <p style="color:#475569;font-size:14px;">This is a test email from your admin panel to verify OTP delivery is working.</p> <div style="background:#fff;border:2px solid #e2e8f0;border-radius:10px;padding:20px;text-align:center;margin:20px 0;"> <p style="color:#64748b;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.1em;">Test OTP Code</p> <p style="font-size:36px;font-weight:900;letter-spacing:8px;color:#0f172a;margin:0;">${code}</p> <p style="color:#94a3b8;font-size:11px;margin:10px 0 0;">Valid for ${otpExpiryMinutes} minutes (test only)</p> </div> <p style="color:#94a3b8;font-size:12px;"> OTP system is configured and working correctly!</p> </div>
`;
 try {
 const res = await fetch('/api/send-email', {
 method:'POST',
 headers: {'Content-Type':'application/json' },
 body: JSON.stringify({
 to: otpTestEmail.trim(),
 subject: otpSubject ||`[${storeName}] Your OTP Code: ${code}`,
 html,
 smtpSettings: {
 isEnabled: smtpEnabled,
 host: smtpHost,
 port: smtpPort,
 email: smtpEmailVal,
 password: smtpPassVal,
 fromName: smtpFromName,
 },
 }),
 });
 const data = await res.json();
 if (data.simulated) {
 setOtpTestStatus({ type:'error', msg:`SMTP not enabled/configured. Test OTP ${code} logged to console.` });
 } else if (data.success) {
 setOtpTestStatus({ type:'success', msg:` Test OTP sent to ${otpTestEmail}! Check inbox (code: ${code})` });
 } else {
 setOtpTestStatus({ type:'error', msg:`Failed: ${data.error ||'Unknown error'}` });
 }
 } catch (e: any) {
 setOtpTestStatus({ type:'error', msg:`Network error: ${e.message}` });
 }
 };

 const handleSaveSMSCMS = async () => {
 try {
 await saveSMSSettings({
 isEnabled: smsEnabled,
 provider:'twilio',
 accountSid: smsAccountSid,
 authToken: smsAuthToken,
 fromNumber: smsFromNumber,
 otpEnabled: smsOtpEnabled,
 otpExpiryMinutes: smsOtpExpiry,
 otpMessageTemplate: smsMsgTemplate,
 });
 await saveEmailVerificationSettings({
 isEnabled: evEnabled,
 requireVerificationBeforeOrder: evRequireBeforeOrder,
 tokenExpiryHours: evTokenExpiry,
 otpSignInVerification: evOtpSignIn,
 });
 showSavedBanner('smtp');
 } catch {
 toast.error('SMS settings save failed.');
 }
 };

 const handleSendTestSms = async () => {
 if (!smsTestPhone.trim()) { setSmsTestStatus({ type:'error', msg:'Enter a phone number first (+country code).' }); return; }
 setSmsTestStatus({ type:'loading', msg:'Sending test SMS…' });
 try {
 const code = String(Math.floor(100000 + Math.random() * 900000));
 const storeName = smtpFromName ||'E-Shop';
 const msg = smsMsgTemplate.replace('{{code}}', code).replace('{{store}}', storeName).replace('{{expiry}}', String(smsOtpExpiry));
 const res = await fetch('/api/send-sms', {
 method:'POST',
 headers: {'Content-Type':'application/json' },
 body: JSON.stringify({ to: smsTestPhone.trim(), message: msg, twilioSettings: { isEnabled: smsEnabled, provider:'twilio', accountSid: smsAccountSid, authToken: smsAuthToken, fromNumber: smsFromNumber } }),
 });
 const data = await res.json();
 if (data.success && !data.simulated) setSmsTestStatus({ type:'success', msg:` Test SMS sent to ${smsTestPhone}! Check your phone.` });
 else if (data.simulated) setSmsTestStatus({ type:'error', msg:'Twilio not configured. Save credentials first.' });
 else setSmsTestStatus({ type:'error', msg:`SMS failed: ${data.error ||'Unknown error'}` });
 } catch {
 setSmsTestStatus({ type:'error', msg:'Server connection error. Is the server running?' });
 }
 setTimeout(() => setSmsTestStatus(null), 8000);
 };



 const handleSavePaymentsCMS = async () => {
 try {
 const current = {
 codEnabled: payCod,
 bKashEnabled: payBkash,
 bKashNo: payBkashNo,
 bKashInstructions: payBkashGuide,
 bKashLogoEmoji: payBkashLogoEmoji,
 bKashQrCodeUrl: payBkashQrCodeUrl,
 nagadEnabled: payNagad,
 nagadNo: payNagadNo,
 nagadInstructions: payNagadGuide,
 nagadLogoEmoji: payNagadLogoEmoji,
 nagadQrCodeUrl: payNagadQrCodeUrl,
 rocketEnabled: payRocket,
 rocketNo: payRocketNo,
 rocketInstructions: payRocketGuide,
 rocketLogoEmoji: payRocketLogoEmoji,
 rocketQrCodeUrl: payRocketQrCodeUrl,
 bankEnabled: payBank,
 bankNo: payBankNo,
 bankInstructions: payBankGuide,
 bankLogoEmoji: payBankLogoEmoji,
 bankQrCodeUrl: payBankQrCodeUrl,
 bankName: payBankName,
 bankHolder: payBankHolder,
 creditManualEnabled: payCreditManual,
 creditManualNo: payCreditManualNo,
 creditManualInstructions: payCreditManualGuide,
 creditManualLogoEmoji: payCreditManualLogoEmoji,
 creditManualQrCodeUrl: payCreditManualQrCodeUrl,
 stripeEnabled: payStripe,
 stripePublicKey: payStripeKey,
 stripeSecretKey: payStripeSecret,
 stripeSandboxMode: payStripeSandbox,
 paypalEnabled: payPaypal,
 paypalClientId: payPaypalClientId,
 paypalClientSecret: payPaypalClientSecret,
 paypalSandboxMode: payPaypalSandbox,
 bKashAutoEnabled: payBkashAuto,
 bKashAppKey: payBkashAppKey,
 bKashAppSecret: payBkashAppSecret,
 bKashUsername: payBkashUsername,
 bKashPassword: payBkashPassword,
 bKashSandboxMode: payBkashSandbox,
 nagadAutoEnabled: payNagadAuto,
 nagadMerchantId: payNagadMerchantId,
 nagadMerchantPrivateKey: payNagadPrivateKey,
 nagadPublicKey: payNagadPublicKey,
 nagadSandboxMode: payNagadSandbox,
 sslCommerzEnabled: paySsl,
 sslCommerzStoreId: paySslStoreId,
 sslCommerzStorePassword: paySslStorePass,
 sslCommerzSandboxMode: paySslSandbox,
 razorpayEnabled: payRazor,
 razorpayKeyId: payRazorKeyId,
 razorpayKeySecret: payRazorKeySecret,
 razorpaySandboxMode: payRazorSandbox,
 // ── New channels (v5.7) ──────────────────────────────────────
 paytmEnabled: payPaytm,
 paytmMerchantId: payPaytmMid,
 paytmMerchantKey: payPaytmKey,
 paytmSandboxMode: payPaytmSandbox,
 upiManualEnabled: payUpi,
 upiId: payUpiId,
 upiPayeeName: payUpiName,
 upiQrCodeUrl: payUpiQr,
 upiInstructions: payUpiInstr,
 jazzCashEnabled: payJazz,
 jazzCashMerchantId: payJazzMid,
 jazzCashPassword: payJazzPwd,
 jazzCashIntegritySalt: payJazzSalt,
 jazzCashSandboxMode: payJazzSandbox,
 easypaisaEnabled: payEasy,
 easypaisaStoreId: payEasyStore,
 easypaisaHashKey: payEasyHash,
 easypaisaSandboxMode: payEasySandbox,
 payFastEnabled: payPf,
 payFastMerchantId: payPfMid,
 payFastMerchantKey: payPfKey,
 payFastPassphrase: payPfPass,
 payFastSandboxMode: payPfSandbox,
 cardPaymentEnabled: paymentSettings.cardPaymentEnabled,

 shippingFee: Number(payFee),
 taxPercentage: Number(payTax),
 // Branding overrides
 codDisplayName: brandCodName,
 codLogoImageUrl: brandCodLogo,
 bKashDisplayName: brandBkashName,
 bKashLogoImageUrl: brandBkashLogo,
 nagadDisplayName: brandNagadName,
 nagadLogoImageUrl: brandNagadLogo,
 rocketDisplayName: brandRocketName,
 rocketLogoImageUrl: brandRocketLogo,
 bankDisplayName: brandBankName,
 bankLogoImageUrl: brandBankLogo,
 creditManualDisplayName: brandCreditManualName,
 creditManualLogoImageUrl: brandCreditManualLogo,
 paypalDisplayName: brandPaypalName,
 paypalLogoImageUrl: brandPaypalLogo,
 stripeDisplayName: brandStripeName,
 stripeLogoImageUrl: brandStripeLogo,
 bKashAutoDisplayName: brandBkashAutoName,
 bKashAutoLogoImageUrl: brandBkashAutoLogo,
 nagadAutoDisplayName: brandNagadAutoName,
 nagadAutoLogoImageUrl: brandNagadAutoLogo,
 sslCommerzDisplayName: brandSslcommerzName,
 sslCommerzLogoImageUrl: brandSslcommerzLogo,
razorpayDisplayName: brandRazorpayName,
razorpayLogoImageUrl: brandRazorpayLogo,
paytmLogoImageUrl: brandPaytmLogo,
upiLogoImageUrl: brandUpiLogo,
jazzCashLogoImageUrl: brandJazzCashLogo,
easypaisaLogoImageUrl: brandEasypaisaLogo,
payFastLogoImageUrl: brandPayFastLogo,
 codSubtext: subtextCod,
 bKashSubtext: subtextBkash,
 nagadSubtext: subtextNagad,
 rocketSubtext: subtextRocket,
 bankSubtext: subtextBank,
 creditManualSubtext: subtextCreditManual,
 paypalSubtext: subtextPaypal,
 stripeSubtext: subtextStripe,
 bKashAutoSubtext: subtextBkashAuto,
 nagadAutoSubtext: subtextNagadAuto,
 sslCommerzSubtext: subtextSslcommerz,
 razorpaySubtext: subtextRazorpay,
 };
 await savePaymentSettings(current);
 showSavedBanner('payment');
 } catch (err) {
 toast.error('Payment CMS update failure.');
 }
 };

 const handleSaveSecurityCMS = async () => {
 if (!secUsername.trim() || !secPass.trim()) {
 toast.error('Username and new password are required to reset credentials.');
 return;
 }
 try {
 const passwordHash = await hashPassword(secPass.trim());
 const current = {
 ...adminSettings,
 username: secUsername.trim(),
 password: passwordHash,
 passwordHash,
 };
 await saveAdminSettings(current);
 setSecPass('');
 showSavedBanner('security');
 } catch (err) {
 toast.error('Security CMS credential updating failed.');
 }
 };

 const handleSaveGoogleCMS = async () => {
 if (googleSignInEnabled && !googleClientId.trim()) {
 toast.error('Please enter a Google Client ID to enable Google Sign-In.');
 return;
 }
 try {
 await saveAdminSettings({
 ...adminSettings,
 googleSignInEnabled,
 googleClientId: googleClientId.trim(),
 });
 showSavedBanner('security');
 } catch (err: any) {
 toast.error('Failed to save Google Sign-In settings: ' + (err?.message ?? 'unknown error'));
 }
 };

 const handleSaveRecaptchaCMS = async () => {
 if (recaptchaEnabled && !recaptchaSiteKey.trim()) {
 toast.error('Please enter a reCAPTCHA Site Key to enable bot protection.');
 return;
 }
 try {
 await saveAdminSettings({
 ...adminSettings,
 recaptchaEnabled,
 recaptchaSiteKey: recaptchaSiteKey.trim(),
 });
 showSavedBanner('security');
 } catch (err: any) {
 toast.error('Failed to save reCAPTCHA settings: ' + (err?.message ?? 'unknown error'));
 }
 };

 const handleSaveSupportCMS = async () => {
 try {
 await saveSupportSettings({
 isEnabled: supportEnabled,
 tawkToId: supportId.trim(),
 });
 showSavedBanner('support');
 } catch (err) {
 toast.error('Chat CMS widget update failure.');
 }
 };


 // --- RENDERING AUTH REQUIRED WALL ---
 if (!isAdminLoggedIn) {
 return (
 <div className="min-h-screen font-sans flex items-center justify-center p-6 relative overflow-hidden" style={{ background:'linear-gradient(135deg, #0f172a 0%, #1e293b 40%, #134e4a 100%)' }}> {/* Animated background blobs */}
 <div className="absolute top-0 left-0 w-96 h-96 rounded-full opacity-10 blur-3xl" style={{ background:'radial-gradient(circle, #10b981, transparent)', transform:'translate(-30%, -30%)' }} /> <div className="absolute bottom-0 right-0 w-96 h-96 rounded-full opacity-10 blur-3xl" style={{ background:'radial-gradient(circle, #6366f1, transparent)', transform:'translate(30%, 30%)' }} /> <div className="absolute inset-0 opacity-5" style={{ backgroundImage:'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize:'32px 32px' }} /> <div className="relative w-full max-w-md"> {/* Card */}
 <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl overflow-hidden shadow-2xl"> {/* Top gradient header */}
 <div className="px-8 pt-10 pb-8 text-center relative" style={{ background:'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(99,102,241,0.2))' }}> <div className="w-20 h-20 rounded-2xl mx-auto flex items-center justify-center shadow-xl mb-5" style={{ background:'linear-gradient(135deg, #10b981, #059669)' }}> <svg viewBox="0 0 40 40" className="w-10 h-10" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M20 4L6 9v10c0 8.5 5.9 16.5 14 18.5C28.1 35.5 34 27.5 34 19V9L20 4z" fill="white" fillOpacity="0.25" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/> <path d="M20 4L6 9v10c0 8.5 5.9 16.5 14 18.5C28.1 35.5 34 27.5 34 19V9L20 4z" fill="white" fillOpacity="0.1"/> <rect x="14" y="18" width="12" height="9" rx="2" fill="white" fillOpacity="0.9"/> <path d="M17 18v-3a3 3 0 016 0v3" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none"/> <circle cx="20" cy="22.5" r="1.5" fill="#059669"/> </svg> </div> <h1 className="text-2xl font-black text-white uppercase tracking-tight">Store Admin</h1> <p className="text-emerald-300 text-xs font-semibold uppercase mt-2 tracking-widest">Secure Control Panel</p> </div> <div className="px-8 pb-8 pt-2"> {/* Success / error toast inline */}
 {loginError && (
 <div className="mb-4 flex items-center gap-2.5 bg-rose-500/20 border border-rose-400/40 rounded-xl px-4 py-3 text-rose-300 text-sm font-semibold animate-fade-in"> <span className="text-lg"></span> {loginError}
 </div> )}
 {loginSuccess && (
 <div className="mb-4 flex items-center gap-2.5 bg-emerald-500/20 border border-emerald-400/40 rounded-xl px-4 py-3 text-emerald-300 text-sm font-semibold animate-fade-in"> <span className="text-lg"></span> {loginSuccess}
 </div> )}
 {lockoutUntil && (
 <div className="mb-4 flex items-center gap-2.5 bg-rose-900/40 border border-rose-500/50 rounded-xl px-4 py-3 text-rose-300 text-sm font-semibold">
   <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
   <span>Locked — {Math.floor(lockoutRemaining / 60)}:{String(lockoutRemaining % 60).padStart(2,'0')} remaining</span>
 </div>
 )}

 <form onSubmit={handleAdminVerify} className="space-y-4"> <div> <label className="block text-[10px] font-bold uppercase text-white/50 mb-1.5 tracking-wider">Username</label> <input
 type="text"
 required
 autoCapitalize="none"
 autoCorrect="off"
 autoComplete="username"
 spellCheck={false}
 value={usernameInput}
 onChange={(e) => setUsernameInput(e.target.value)}
 placeholder="Enter admin username"
 className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-sm font-semibold text-white placeholder-white/30 outline-none focus:bg-white/20 focus:border-emerald-400/70 transition-all"
 /> </div> <div> <label className="block text-[10px] font-bold uppercase text-white/50 mb-1.5 tracking-wider">Password</label> <div className="relative"> <input
 type={showPassword ? 'text' : 'password'}
 required
 autoComplete="current-password"
 value={passwordInput}
 onChange={(e) => setPasswordInput(e.target.value)}
 placeholder="••••••••••••"
 className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 pr-12 text-sm font-semibold text-white placeholder-white/40 outline-none focus:bg-white/20 focus:border-emerald-400/70 transition-all"
 /> <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 transition-colors p-1" tabIndex={-1} aria-label={showPassword ? 'Hide password' : 'Show password'}> {showPassword ? ( <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg> ) : ( <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> )} </button> </div> </div> <div className="pt-1"> <button
 type="submit"
 disabled={loginLoading || isLoading || !!lockoutUntil}
 className="w-full cursor-pointer py-3.5 font-black uppercase text-sm tracking-wider transition-all rounded-xl shadow-lg text-white flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
 style={{ background:'linear-gradient(135deg, #10b981, #059669)' }}
 >{isLoading ? (
   <><svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Loading...</>
 ) : loginLoading ? (
   <><svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Verifying...</>
 ) : 'Access Command Center'}
 </button> </div> </form> <a href="/" className="mt-5 block text-center text-xs font-semibold text-white/40 hover:text-white/70 transition-colors uppercase tracking-wide"> ← Back to Storefront
 </a> </div> </div> <p className="text-center text-white/20 text-[10px] mt-6 font-medium uppercase tracking-widest">Protected by Store Admin Security</p> </div> </div> );
 }

 return (
 <div className="min-h-screen bg-slate-50 font-sans text-slate-800 pb-16 flex flex-col"> {/* ── SAVE SUCCESS POPUP BANNER ── */}
 {savedBanner.show && (
 <div className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none"> <div className="pointer-events-auto animate-bounce-in"> <div className="bg-white rounded-2xl shadow-2xl border border-emerald-200 px-8 py-6 flex flex-col items-center gap-3 min-w-[260px]"> <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center"> <svg viewBox="0 0 48 48" className="w-8 h-8" fill="none"> <circle cx="24" cy="24" r="24" fill="#10b981" opacity="0.15"/> <path d="M13 25l8 8 14-16" stroke="#10b981" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/> </svg> </div> <div className="text-center"> <div className="font-bold text-slate-800 text-base">Saved!</div> <div className="text-xs text-slate-500 mt-0.5 capitalize">{savedBanner.type} settings updated successfully</div> </div> <div className="flex gap-1 mt-1"> {[0,1,2].map(i => (
 <div key={i} className="w-1.5 h-1.5 rounded-full bg-emerald-400" style={{animationDelay:`${i*0.15}s`}}/> ))}
 </div> </div> </div> </div> )}

 {/* CMS CONFIRM MODAL OVERLAY */}
 {confirmState.isOpen && (
 <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs select-none"> <div className="bg-white rounded-2xl max-w-sm w-full p-6 border border-slate-200 shadow-2xl"> <h3 className="font-extrabold text-base text-slate-800 uppercase tracking-tight mb-2">
              {confirmState.title}
 </h3> <p className="text-xs text-slate-500 mb-6 font-medium leading-relaxed"> {confirmState.message}
 </p> <div className="flex items-center justify-end gap-3"> <button
 type="button"
 onClick={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
 className="px-4 py-2 cursor-pointer bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wide transition-colors"
 > Cancel
 </button> <button
 type="button"
 onClick={confirmState.onConfirm}
 className="px-4 py-2 cursor-pointer bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-xl text-xs font-bold uppercase tracking-wide shadow-md shadow-rose-300 transition-all font-sans border border-rose-700"
 > Confirm Action
 </button> </div> </div> </div> )}

 {/* CMS Header navigation */}
 <header className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col sm:flex-row gap-4 items-center justify-between select-none shadow-sm"> <div className="flex items-center gap-3"> <div className="bg-emerald-500 text-white p-1.5 rounded-xl shadow-sm w-10 h-10 flex items-center justify-center overflow-hidden flex-shrink-0"> {siteSettings.logoUrl ? (
 <img src={siteSettings.logoUrl} alt="Site Logo" className="w-full h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display ='none'; }} /> ) : (
 <span className="text-xl select-none"></span> )}
 </div> <div> <h1 className="text-lg sm:text-xl font-bold uppercase tracking-tight text-slate-800 flex items-center gap-2">
              Store Admin {databaseEngine === 'firebase' && getIsFirebaseConfigured() ? (
 <span className="bg-emerald-100 text-emerald-700 border border-emerald-300 text-[10px] font-black uppercase px-2 py-0.5 rounded-full tracking-wider">Firebase Live</span>
 ) : databaseEngine === 'supabase' && getIsSupabaseConfigured() ? (
 <span className="bg-blue-100 text-blue-700 border border-blue-300 text-[10px] font-black uppercase px-2 py-0.5 rounded-full tracking-wider">Supabase Live</span>
 ) : databaseEngine === 'supabase' ? (
 <span className="bg-blue-100 text-blue-700 border border-blue-300 text-[10px] font-black uppercase px-2 py-0.5 rounded-full tracking-wider">Supabase</span>
 ) : (
 <span className="bg-amber-100 text-amber-700 border border-amber-300 text-[10px] font-black uppercase px-2 py-0.5 rounded-full tracking-wider">Local Mock</span>
 )}
 </h1>
 <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">Website Type: {brandName}</p> </div> </div> <div className="flex items-center gap-3 w-full sm:w-auto"> <a
 href="/"
 className="flex-1 sm:flex-none text-center px-4 py-2 bg-emerald-500 text-white font-semibold text-xs uppercase shadow-sm hover:bg-emerald-600 rounded-xl"
 target="_blank"
 > Go to Storefront
 </a> <button
 onClick={handleLogout}
 className="cursor-pointer p-2 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-100"
 title="Terminate secure session logout"
 > <LogOut className="w-5 h-5" /> </button> </div> </header>

{/* ── SUPABASE REALTIME SYNC BANNER ── */}
{databaseEngine === 'supabase' && (
  <div className={`flex items-center gap-2.5 px-6 py-1.5 text-[11px] font-semibold border-b select-none transition-all duration-500 ${realtimePulse ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-blue-50 border-blue-100 text-blue-500'}`}>
    <span className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors duration-500 ${realtimePulse ? 'bg-emerald-500 animate-pulse' : 'bg-blue-300'}`} />
    {realtimePulse
      ? '⚡ Real-time sync active — settings change received from Supabase'
      : '🔵 Real-time sync connected — Supabase Realtime is listening for changes'}
  </div>
)}

<div className="max-w-7xl mx-auto w-full px-6 grid grid-cols-1 lg:grid-cols-12 gap-8 mt-8 flex-1"> {/* Navigation Sidebar Panel */}
 <nav className="lg:col-span-3 flex lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible py-2 select-none border-b lg:border-b-0 border-slate-200 pb-4 mb-4" id="admin-sidebar"> <button
 onClick={() => setActiveTab('products')}
 className={`flex-shrink-0 flex items-center gap-2.5 px-4 py-3 rounded-xl border text-xs font-semibold uppercase transition-all cursor-pointer ${
 activeTab ==='products'
 ?'bg-emerald-600 text-white border-transparent shadow-sm'
 :'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
 }`}
 > <Package className="w-5 h-5" /> <span>Products & stock</span> </button> <button
 onClick={() => setActiveTab('orders')}
 className={`flex-shrink-0 flex items-center gap-2.5 px-4 py-3 rounded-xl border text-xs font-semibold uppercase transition-all cursor-pointer ${
 activeTab ==='orders'
 ?'bg-emerald-600 text-white border-transparent shadow-sm'
 :'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
 }`}
 > <ShoppingBag className="w-5 h-5" /> <span>Client Orders ({orders.length})</span> </button> <button
 onClick={() => setActiveTab('coupons')}
 className={`flex-shrink-0 flex items-center gap-2.5 px-4 py-3 rounded-xl border text-xs font-semibold uppercase transition-all cursor-pointer ${
 activeTab ==='coupons'
 ?'bg-emerald-600 text-white border-transparent shadow-sm'
 :'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
 }`}
 > <Ticket className="w-5 h-5" /> <span>Discount Coupons ({coupons.length})</span> </button> <button
 onClick={() => setActiveTab('reviews')}
 className={`flex-shrink-0 flex items-center gap-2.5 px-4 py-3 rounded-xl border text-xs font-semibold uppercase transition-all cursor-pointer ${
 activeTab ==='reviews'
 ?'bg-emerald-600 text-white border-transparent shadow-sm'
 :'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
 }`}
 > <Star className="w-5 h-5" /> <span>Moderation ({reviews.filter(r => !r.isApproved).length} pending)</span> </button> <button
 onClick={() => setActiveTab('subscribers')}
 className={`flex-shrink-0 flex items-center gap-2.5 px-4 py-3 rounded-xl border text-xs font-semibold uppercase transition-all cursor-pointer ${
 activeTab ==='subscribers'
 ?'bg-emerald-600 text-white border-transparent shadow-sm'
 :'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
 }`}
 > <Users className="w-5 h-5" /> <span>Subscribers ({newsletterSubscribers.length})</span> </button> <button
 onClick={() => setActiveTab('sections')}
 className={`flex-shrink-0 flex items-center gap-2.5 px-4 py-3 rounded-xl border text-xs font-semibold uppercase transition-all cursor-pointer ${
 activeTab ==='sections'
 ?'bg-emerald-600 text-white border-transparent shadow-sm'
 :'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
 }`}
 > <Palette className="w-5 h-5" /> <span>Page Sections</span> </button> <button
 onClick={() => setActiveTab('settings')}
 className={`flex-shrink-0 flex items-center gap-2.5 px-4 py-3 rounded-xl border text-xs font-semibold uppercase transition-all cursor-pointer ${
 activeTab ==='settings'
 ?'bg-emerald-600 text-white border-transparent shadow-sm'
 :'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
 }`}
 > <Settings className="w-5 h-5" /> <span>CMS settings</span> </button>
 <button
 onClick={() => setActiveTab('backend')}
 className={`flex-shrink-0 flex items-center gap-2.5 px-4 py-3 rounded-xl border text-xs font-semibold uppercase transition-all cursor-pointer ${
 activeTab ==='backend'
 ?'bg-emerald-600 text-white border-transparent shadow-sm'
 :'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
 }`}
 > <Server className="w-5 h-5" /> <span>Backend</span> </button>
 </nav> {/* Content Panel */}
 <main className="lg:col-span-9 bg-white border border-slate-200 rounded-2xl p-6 min-h-[500px] shadow-sm"> {/* TAB 1: PRODUCTS DISPLAY LIST */}
 {activeTab ==='products' && (
<div className="space-y-6"> <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-slate-100 pb-4"> <div> <h3 className="text-lg font-bold text-slate-800 uppercase">Products Catalog Inventory</h3> <p className="text-xs text-slate-500 font-medium">Update prices, replenish stock counts, or add new products.</p> </div> <button
 onClick={() => handleOpenProductForm(null)}
 className="w-full sm:w-auto cursor-pointer flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 hover:translate-y-[-0.5px] text-white font-sans font-semibold uppercase text-xs rounded-xl shadow-xs transition-colors"
 > <Plus className="w-4 h-4" /> <span>Add New Product</span> </button>
 <label className="w-auto cursor-pointer inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white font-sans font-semibold uppercase text-[10px] rounded-lg shadow-xs transition-colors select-none whitespace-nowrap">
   <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M4 8l8-8 8 8M12 4v12"/></svg>
   <span>Import CSV</span>
   <input type="file" accept=".csv,text/csv" className="sr-only" onChange={handleBulkCSVImport} disabled={csvImporting} />
 </label>
<button
  type="button"
  onClick={exportProductsCSV}
  disabled={products.length === 0}
  className="w-auto cursor-pointer inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white font-sans font-semibold uppercase text-[10px] rounded-lg shadow-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed select-none whitespace-nowrap"
>
  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 4v12m0 0l-4-4m4 4l4-4"/></svg>
  <span>Export CSV</span>
</button>
</div>

{/* CSV IMPORT STATUS + RESULTS */}
{(csvImporting || csvResults) && (
  <div className={`rounded-xl border p-4 space-y-2 ${csvImporting ? 'bg-violet-50 border-violet-200' : csvResults && csvResults.failed === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
    {csvImporting ? (
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 animate-spin text-violet-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
        <p className="text-xs font-bold text-violet-700 uppercase">Importing products…</p>
      </div>
    ) : csvResults && (
      <>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase text-slate-700">Import Results</p>
          <button onClick={() => setCsvResults(null)} className="text-[10px] text-slate-400 hover:text-rose-500 cursor-pointer">✕ Dismiss</button>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[10px] font-black">✓</span>
            <span className="text-xs font-bold text-emerald-700">{csvResults.imported} imported</span>
          </div>
          {csvResults.failed > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-rose-500 flex items-center justify-center text-white text-[10px] font-black">✕</span>
              <span className="text-xs font-bold text-rose-700">{csvResults.failed} failed</span>
            </div>
          )}
        </div>
        {csvResults.errors.length > 0 && (
          <div className="bg-white border border-rose-100 rounded-lg p-2.5 max-h-28 overflow-y-auto space-y-0.5">
            {csvResults.errors.map((err, i) => (
              <p key={i} className="text-[9px] text-rose-700 font-mono leading-tight">{err}</p>
            ))}
          </div>
        )}
      </>
    )}
    <div className="pt-1 border-t border-slate-200 flex items-center gap-2 flex-wrap">
      <p className="text-[9px] text-slate-400 font-medium">Columns: <span className="font-mono text-slate-600">name*, category, description, price*, salePrice, stock, image, featured</span> — * required</p>
      <button onClick={downloadCsvTemplate} className="text-[9px] font-bold text-violet-600 hover:underline cursor-pointer flex-shrink-0">⬇ Download template CSV</button>
    </div>
  </div>
)}

{/* PRODUCTS MANAGEMENT POPUP MODAL BLOCK */}
 {isProductFormOpen && (
 <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl relative mb-6 shadow-xs"> <h4 className="text-sm font-bold text-slate-800 uppercase mb-4 border-b border-slate-200 pb-2 animate-pulse"> {editingProduct ?'Edit Product Details' :'Create New Product listing'}
 </h4> <form onSubmit={handleSaveProduct} className="grid grid-cols-1 md:grid-cols-2 gap-4"> <div> <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Product Title *</label> <input
 type="text"
 required
 value={prodName}
 onChange={(e) => setProdName(e.target.value)}
 placeholder="e.g. Blue T-Shirt / Wireless Earbuds / Mango Juice"
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 outline-none font-medium focus:ring-1 focus:ring-emerald-400"
 /> </div> <div> <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Category Mapped *</label> <select
 value={prodCategory}
 onChange={(e) => setProdCategory(e.target.value)}
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 outline-none font-medium capitalize focus:ring-1 focus:ring-emerald-400"
 > {categories.map((cat) => (
 <option key={cat.id} value={cat.name} className="text-slate-900 bg-white font-medium">{cat.name}</option> ))}
 </select> </div> <div className="md:col-span-2"> <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Description</label> <textarea
 rows={2}
 value={prodDesc}
 onChange={(e) => setProdDesc(e.target.value)}
 placeholder="Describe your product — features, materials, flavors, specs, or anything relevant..."
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 outline-none font-medium resize-none focus:ring-1 focus:ring-emerald-400"
  ></textarea> </div>
 {/* ───── PRODUCT MODE TOGGLE ───── */}
 <div className="md:col-span-2">
   <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">Product Type *</label>
   <div className="inline-flex bg-white border border-slate-200 rounded-xl overflow-hidden text-xs font-bold">
     <button
       type="button"
       onClick={() => setProductMode('single')}
       className={`px-4 py-1.5 transition-colors ${productMode === 'single' ? 'bg-emerald-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
     >Single Product</button>
     <button
       type="button"
       onClick={() => setProductMode('variant')}
       className={`px-4 py-1.5 transition-colors border-l border-slate-200 ${productMode === 'variant' ? 'bg-emerald-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
     >Variant Product</button>
   </div>
   <p className="text-[10px] text-slate-400 mt-1">
     {productMode === 'single'
       ? 'One fixed price and stock count. The variant editor is hidden.'
       : 'Each variant (e.g. 250 ml / 500 ml, Size: L / XL) has its own price and stock. The single Price & Stock fields are hidden.'}
   </p>
 </div>
 {productMode === 'single' && (<>
 <div> <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">List Price *</label> <input
  type="number"
  step="0.01"
  required
  value={prodPrice}
  onChange={(e) => setProdPrice(Number(e.target.value))}
  className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 outline-none font-medium focus:ring-1 focus:ring-emerald-400"
 /> </div> <div> <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Active Sale Price (Optional)</label> <input
  type="number"
  step="0.01"
  value={prodSalePrice === null ?'' : prodSalePrice}
  onChange={(e) => setProdSalePrice(e.target.value ==='' ? null : Number(e.target.value))}
  className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 outline-none font-medium focus:ring-1 focus:ring-emerald-400"
 /> </div> <div className="md:col-span-2"> <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Stock Count *</label> <input
  type="number"
  required
  value={prodStock}
  onChange={(e) => setProdStock(Number(e.target.value))}
  className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 outline-none font-medium focus:ring-1 focus:ring-emerald-400"
 /> </div>
 </>)}
 <div className="md:col-span-2"> <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">Product Image *</label>
 <div className="space-y-3"> {/* Recommended sizes info box */}
 <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-[10px] text-blue-800 leading-relaxed"> <p className="font-bold text-blue-900 uppercase mb-1"> Recommended Image Sizes</p> <div className="grid grid-cols-2 gap-x-4 gap-y-0.5"> <p>• Product card display: <span className="font-bold">600 × 600 px</span></p> <p>• Aspect ratio: <span className="font-bold">1:1 (square)</span></p> <p>• Min resolution: <span className="font-bold">300 × 300 px</span></p> <p>• Max file size: <span className="font-bold">2 MB</span></p> <p>• Formats: <span className="font-bold">JPG, PNG, WebP, GIF, SVG</span></p> <p>• Color mode: <span className="font-bold">RGB / sRGB</span></p> </div> <p className="mt-1.5 text-blue-700"> Square images look best on product cards. Transparent PNG recommended for clean backgrounds.</p> </div> {/* Upload file button */}
 <div> <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Upload from device</label> <label className="flex items-center gap-2 w-fit px-3 py-2 bg-white border border-dashed border-emerald-400 hover:bg-emerald-50 rounded-xl cursor-pointer transition-colors group"> <span className="text-emerald-600 text-lg"></span> <span className="text-xs font-semibold text-emerald-700 group-hover:text-emerald-800">Choose Image File</span> <input
 type="file"
 accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
 onChange={handleImageFileUpload}
 className="hidden"
 /> </label> </div> {/* OR URL input */}
 <div> <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">— or paste image URL</label> <input
 type="url"
 value={prodImageMode ==='url' && !prodImage.startsWith('data:') ? prodImage :''}
                              onChange={(e) => { setProdImage(e.target.value); setProdImagePreview(e.target.value); setProdImageUploadError(''); }}
 placeholder="https://example.com/product.jpg"
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 outline-none font-medium focus:ring-1 focus:ring-emerald-400"
 /> </div> {/* Error message */}
 {prodImageUploadError && (
 <p className="text-[10px] text-rose-600 font-semibold bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5"> {prodImageUploadError}
 </p> )}

 {/* Preview */}
 {prodImagePreview && !prodImageUploadError && (
 <div className="flex items-start gap-3"> <div> <p className="text-[9px] font-bold uppercase text-slate-400 mb-1">Preview</p> <img
 src={prodImagePreview}
 alt="Product preview"
 onError={() => { setProdImageUploadError('Cannot load image from this URL. Check the address or upload a file instead.'); setProdImagePreview(''); }}
 className="w-20 h-20 object-cover rounded-xl border border-slate-200 shadow-sm"
 /> </div> <div className="text-[10px] text-slate-400 mt-5 leading-relaxed"> <p>Card size: ~200px wide</p> <p>Table icon: 28×28px</p> </div> <button
 type="button"
                                onClick={() => { setProdImage(''); setProdImagePreview(''); }}
 className="mt-5 text-rose-500 hover:text-rose-700 text-xs font-bold cursor-pointer"
 > Remove
 </button> </div>
 )}
 </div>

 </div>

 {/* ─── COVER IMAGE LABEL RENAME ─── already rendered above as "Product Image" ─── */}

 {/* ─────────────────────────────────────────────────────────────────
      GALLERY IMAGES SECTION
 ───────────────────────────────────────────────────────────────── */}
 <div className="md:col-span-2 mt-1">
   <div className="border border-slate-200 rounded-2xl p-4 bg-white">
     <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
       <span className="w-2 h-2 rounded-full bg-indigo-400 inline-block"></span>
       Gallery Images
       <span className="text-slate-400 font-normal normal-case ml-1">(shown only on product detail page)</span>
     </h5>

     {/* Upload multiple */}
     <label className="flex items-center gap-2 w-fit px-3 py-2 bg-white border border-dashed border-indigo-400 hover:bg-indigo-50 rounded-xl cursor-pointer transition-colors group mb-3">
       <span className="text-indigo-600 text-base">🖼</span>
       <span className="text-xs font-semibold text-indigo-700 group-hover:text-indigo-800">Add Gallery Images</span>
       <input
         type="file"
         multiple
         accept="image/jpeg,image/png,image/webp"
         className="hidden"
         onChange={(e) => {
           setGalleryUploadError('');
           const files = Array.from(e.target.files || []) as File[];
           e.target.value = '';
           Promise.all(
             files.map((file: File) => {
               const v = validateImageFile(file, 3);
               if (!v.valid) { setGalleryUploadError(v.error || 'Invalid file'); return null; }
               return fileToBase64(file).then(b64 => ({
                 id: 'gi_' + Math.random().toString(36).substr(2, 9),
                 productId: editingProduct?.id || '',
                 imageUrl: b64,
                 sortOrder: 0,
               } as import('../types').ProductImage));
             })
           ).then(results => {
             const valid = results.filter(Boolean) as import('../types').ProductImage[];
             setGalleryImages(prev => [...prev, ...valid]);
           });
         }}
       />
     </label>
     {galleryUploadError && <p className="text-[10px] text-rose-600 font-semibold mb-2">{galleryUploadError}</p>}

     {galleryImages.length === 0 ? (
       <p className="text-[10px] text-slate-400 italic">No gallery images yet. Add some above.</p>
     ) : (
       <div className="flex flex-wrap gap-2">
         {galleryImages.map((img, idx) => (
           <div key={img.id} className="relative group">
             <img src={img.imageUrl} alt="" className="w-16 h-16 object-cover rounded-xl border border-slate-200 shadow-sm" />
             <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 rounded-xl transition-opacity flex items-center justify-center gap-1">
               <button type="button"
                 onClick={() => setGalleryImages(prev => prev.filter((_, i) => i !== idx))}
                 className="bg-rose-500 text-white rounded-lg p-1 text-[10px] font-bold cursor-pointer"
                 title="Remove"
               >✕</button>
               {idx > 0 && (
                 <button type="button"
                   onClick={() => setGalleryImages(prev => { const n = [...prev]; [n[idx-1], n[idx]] = [n[idx], n[idx-1]]; return n; })}
                   className="bg-white/80 text-slate-700 rounded-lg p-1 text-[10px] font-bold cursor-pointer"
                   title="Move left"
                 >←</button>
               )}
               {idx < galleryImages.length - 1 && (
                 <button type="button"
                   onClick={() => setGalleryImages(prev => { const n = [...prev]; [n[idx], n[idx+1]] = [n[idx+1], n[idx]]; return n; })}
                   className="bg-white/80 text-slate-700 rounded-lg p-1 text-[10px] font-bold cursor-pointer"
                   title="Move right"
                 >→</button>
               )}
             </div>
           </div>
         ))}
       </div>
     )}
   </div>
 </div>

 {/* ─────────────────────────────────────────────────────────────────
      VARIANTS SECTION — only rendered when admin opted into the
      Variant product type for this product.
 ───────────────────────────────────────────────────────────────── */}
 {productMode === 'variant' && (
 <div className="md:col-span-2 mt-1">
   <div className="border border-slate-200 rounded-2xl p-4 bg-white">
     <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
       <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
       Product Variants
       <span className="text-slate-400 font-normal normal-case ml-1">(e.g. Size, Color, Storage)</span>
     </h5>

     {/* Add variant group */}
     <div className="flex gap-2 mb-4">
       <input
         type="text"
         value={newGroupName}
         onChange={e => setNewGroupName(e.target.value)}
         placeholder="Group name (e.g. Size, Color)"
         className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 outline-none font-medium focus:ring-1 focus:ring-emerald-400"
       />
       <button
         type="button"
         onClick={() => {
           const name = newGroupName.trim();
           if (!name) return;
           if (variantGroups.find(g => g.groupName.toLowerCase() === name.toLowerCase())) return;
           const newGroup: ProductVariantGroup = {
             id: 'vg_' + Math.random().toString(36).substr(2, 9),
             productId: editingProduct?.id || '',
             groupName: name,
           };
           setVariantGroups(prev => [...prev, newGroup]);
           setNewGroupName('');
           setNewVariantInput(prev => ({ ...prev, [name]: { value: '', price: '', stock: '', imageUrl: '' } }));
         }}
         className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold uppercase cursor-pointer"
       >+ Group</button>
     </div>

     {variantGroups.length === 0 ? (
       <p className="text-[10px] text-slate-400 italic">No variant groups yet. Add one above (e.g. "Size").</p>
     ) : (
       <div className="space-y-4">
         {variantGroups.map(group => {
           const groupVariants = variantRows.filter(v => v.groupName === group.groupName);
          const inp = newVariantInput[group.groupName] || { value: '', price: '', stock: '', imageUrl: '' };
           return (
             <div key={group.id} className="bg-slate-50 rounded-xl p-3 border border-slate-200">
               <div className="flex items-center justify-between mb-2">
                 <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">{group.groupName}</span>
                 <button
                   type="button"
                   onClick={() => {
                     setVariantGroups(prev => prev.filter(g => g.id !== group.id));
                     setVariantRows(prev => prev.filter(v => v.groupName !== group.groupName));
                     setNewVariantInput(prev => { const n = {...prev}; delete n[group.groupName]; return n; });
                   }}
                   className="text-rose-500 hover:text-rose-700 text-xs font-bold cursor-pointer"
                 >Remove Group</button>
               </div>

               {/* Existing variants */}
               {groupVariants.length > 0 && (
                 <div className="flex flex-col gap-1.5 mb-3">
                   <div className="space-y-2">
                   {groupVariants.map(v => (
                     <div key={v.id} className="bg-white border border-slate-200 rounded-xl p-2.5 flex flex-col gap-2">
                       {/* Row 1: Value + Price + Stock + Delete */}
                       <div className="grid grid-cols-12 gap-1 items-center">
                         <input
                           value={v.variantValue}
                           onChange={e => setVariantRows(prev => prev.map(r => r.id === v.id ? { ...r, variantValue: e.target.value } : r))}
                           placeholder="Value (e.g. 500ml)"
                           className="col-span-4 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] text-slate-800 outline-none focus:ring-1 focus:ring-emerald-400"
                         />
                         <input
                           type="number" step="0.01" min="0"
                           value={v.price}
                           onChange={e => setVariantRows(prev => prev.map(r => r.id === v.id ? { ...r, price: Number(e.target.value) } : r))}
                           placeholder="Price"
                           className="col-span-3 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] text-slate-800 outline-none focus:ring-1 focus:ring-emerald-400"
                         />
                         <input
                           type="number" min="0"
                           value={v.stock}
                           onChange={e => setVariantRows(prev => prev.map(r => r.id === v.id ? { ...r, stock: Number(e.target.value) } : r))}
                           placeholder="Stock"
                           className="col-span-3 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] text-slate-800 outline-none focus:ring-1 focus:ring-emerald-400"
                         />
                         <button type="button"
                           onClick={() => setVariantRows(prev => prev.filter(r => r.id !== v.id))}
                           className="col-span-2 text-rose-500 hover:text-rose-700 text-[11px] font-bold cursor-pointer text-center"
                         >✕</button>
                       </div>
                       {/* Row 2: Variant image */}
                       <div className="flex items-center gap-2">
                         <label className="text-[9px] font-bold uppercase text-slate-400 w-16 shrink-0">Variant Image</label>
                         {v.imageUrl ? (
                           <div className="relative group">
                             <img src={v.imageUrl} alt="" className="w-10 h-10 object-cover rounded-lg border border-slate-200" />
                             <button type="button"
                               onClick={() => setVariantRows(prev => prev.map(r => r.id === v.id ? { ...r, imageUrl: '' } : r))}
                               className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                             >✕</button>
                           </div>
                         ) : (
                           <label className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 border border-dashed border-slate-300 hover:border-emerald-400 hover:bg-emerald-50 rounded-lg cursor-pointer transition-colors text-[10px] font-semibold text-slate-500 hover:text-emerald-700">
                             <span>📷</span> Upload image
                             <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                               onChange={async (e) => {
                                 const file = e.target.files?.[0]; e.target.value = '';
                                 if (!file) return;
                                 const b64 = await fileToBase64(file);
                                 setVariantRows(prev => prev.map(r => r.id === v.id ? { ...r, imageUrl: b64 } : r));
                               }}
                             />
                           </label>
                         )}
                         <span className="text-[9px] text-slate-400 italic">Shown when customer selects this variant</span>
                       </div>
                     </div>
                   ))}
                   </div>
                 </div>
               )}

               {/* Add new variant value row */}
               <div className="bg-white border border-dashed border-slate-300 rounded-xl p-2.5 flex flex-col gap-2 mt-1">
                 <div className="grid grid-cols-12 gap-1 items-center">
                   <input
                     type="text"
                     value={inp.value}
                     onChange={e => setNewVariantInput(prev => ({ ...prev, [group.groupName]: { ...inp, value: e.target.value } }))}
                     placeholder="Value (e.g. 500ml)"
                     className="col-span-4 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] text-slate-800 outline-none focus:ring-1 focus:ring-emerald-400"
                   />
                   <input
                     type="number" step="0.01" min="0"
                     value={inp.price}
                     onChange={e => setNewVariantInput(prev => ({ ...prev, [group.groupName]: { ...inp, price: e.target.value } }))}
                     placeholder="Price"
                     className="col-span-3 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] text-slate-800 outline-none focus:ring-1 focus:ring-emerald-400"
                   />
                   <input
                     type="number" min="0"
                     value={inp.stock}
                     onChange={e => setNewVariantInput(prev => ({ ...prev, [group.groupName]: { ...inp, stock: e.target.value } }))}
                     placeholder="Stock"
                     className="col-span-3 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] text-slate-800 outline-none focus:ring-1 focus:ring-emerald-400"
                   />
                   <button type="button"
                     onClick={() => {
                       if (!inp.value.trim()) return;
                       const newVariant: ProductVariant = {
                         id: 'pv_' + Math.random().toString(36).substr(2, 9),
                         productId: editingProduct?.id || '',
                         groupName: group.groupName,
                         variantValue: inp.value.trim(),
                         price: Number(inp.price) || 0,
                         stock: Number(inp.stock) || 0,
                         imageUrl: inp.imageUrl || undefined,
                       };
                       setVariantRows(prev => [...prev, newVariant]);
                       setNewVariantInput(prev => ({ ...prev, [group.groupName]: { value: '', price: '', stock: '', imageUrl: '' } }));
                     }}
                     className="col-span-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-[11px] font-bold cursor-pointer py-1 text-center"
                   >+ Add</button>
                 </div>
                 {/* Image for new variant */}
                 <div className="flex items-center gap-2">
                   <label className="text-[9px] font-bold uppercase text-slate-400 w-16 shrink-0">Image</label>
                   {inp.imageUrl ? (
                     <div className="relative group">
                       <img src={inp.imageUrl} alt="" className="w-10 h-10 object-cover rounded-lg border border-slate-200" />
                       <button type="button"
                         onClick={() => setNewVariantInput(prev => ({ ...prev, [group.groupName]: { ...inp, imageUrl: '' } }))}
                         className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                       >✕</button>
                     </div>
                   ) : (
                     <label className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 border border-dashed border-slate-300 hover:border-emerald-400 hover:bg-emerald-50 rounded-lg cursor-pointer transition-colors text-[10px] font-semibold text-slate-500 hover:text-emerald-700">
                       <span>📷</span> Upload image
                       <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                         onChange={async (e) => {
                           const file = e.target.files?.[0]; e.target.value = '';
                           if (!file) return;
                           const b64 = await fileToBase64(file);
                           setNewVariantInput(prev => ({ ...prev, [group.groupName]: { ...inp, imageUrl: b64 } }));
                         }}
                       />
                     </label>
                   )}
                   <span className="text-[9px] text-slate-400 italic">Shown when customer selects this variant</span>
                 </div>
               </div>
             </div>
           );
         })}
       </div>
     )}
   </div>
  </div>
 )}

 <div className="flex items-center gap-2 pt-4"> <input
 type="checkbox"
 id="prod-feat"
 checked={prodFeatured}
 onChange={(e) => setProdFeatured(e.target.checked)}
 className="scale-110 accent-emerald-500 cursor-pointer"
 /> <label htmlFor="prod-feat" className="text-xs font-bold text-slate-600 uppercase cursor-pointer select-none">Highlight as Featured</label> </div> <div className="md:col-span-2 flex justify-end gap-2 border-t border-slate-200 pt-3"> <button
 type="button"
 onClick={() => setIsProductFormOpen(false)}
 className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold uppercase cursor-pointer bg-white text-slate-600 hover:bg-slate-50"
 > Cancel
 </button> <button
 type="submit"
 className="px-5 py-2 hover:bg-emerald-600 bg-emerald-500 text-white rounded-lg text-xs font-semibold uppercase cursor-pointer shadow-xs"
 > Save Product Listing
 </button> </div> </form> </div> )}

 {/* QUICK CATEGORIES MANAGER PANEL */}
 <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex flex-col gap-4 shadow-sm">
 <div className="flex items-center justify-between mb-1">
   <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Categories</p>
 </div>
 <div className="flex flex-col gap-3"> <form onSubmit={handleCreateCategory} className="flex flex-col gap-3 w-full"> {/* Row 1: Name + Add button */}
 <div className="flex gap-2 w-full items-center"> <input
 type="text"
 required
 placeholder="NEW CATEGORY NAME (e.g. Coffee)"
 value={newCatName}
 onChange={(e) => setNewCatName(e.target.value)}
 className="flex-1 bg-white border border-slate-200 px-3 py-1.5 rounded-lg font-semibold text-xs text-slate-700 uppercase tracking-wide outline-none focus:ring-1 focus:ring-emerald-400"
 /> <button
 type="submit"
 className="px-3.5 py-1.5 cursor-pointer bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold uppercase border border-transparent"
 > + Add
 </button> </div> {/* Row 2: Category Image — USE EMOJI / USE PICTURE tabs */}
 <div> <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">CATEGORY ICON</label> <div className="flex gap-2 mb-2"> <button
 type="button"
 onClick={() => setNewCatImageMode('emoji')}
 className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border cursor-pointer transition-all ${newCatImageMode ==='emoji' ?'bg-white border-slate-900 text-slate-900 shadow-sm' :'bg-slate-100 border-transparent text-slate-500 hover:bg-slate-200'}`}
 > Use Emoji
 </button> <button
 type="button"
 onClick={() => setNewCatImageMode('picture')}
 className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border cursor-pointer transition-all ${newCatImageMode ==='picture' ?'bg-white border-slate-900 text-slate-900 shadow-sm' :'bg-slate-100 border-transparent text-slate-500 hover:bg-slate-200'}`}
 > Use Picture
 </button> </div> {newCatImageMode ==='emoji' ? (
 <div className="flex items-center gap-2"> <input
 type="text"
 maxLength={8}
 placeholder=""
                            value={newCatEmoji}
                            onChange={(e) => setNewCatEmoji(e.target.value)}
 className="w-14 text-center bg-white border border-slate-200 rounded-lg font-bold text-lg outline-none focus:ring-1 focus:ring-emerald-400 py-1"
 /> <span className="text-[10px] text-slate-400">Paste or type any emoji</span> </div> ) : (
 <div className="flex items-center gap-2"> <input
 type="url"
 placeholder="https://example.com/icon.png"
 value={newCatImageUrl}
 onChange={(e) => setNewCatImageUrl(e.target.value)}
 className="flex-1 bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-[11px] text-slate-600 outline-none focus:ring-1 focus:ring-emerald-400"
 /> {newCatImageUrl.trim() && (
 <img src={newCatImageUrl} alt="preview" className="w-8 h-8 object-contain rounded border border-slate-200 bg-white" onError={(e) => (e.currentTarget.style.display ='none')} /> )}
 </div> )}
 </div> </form> </div> {/* Category cards with edit / visibility / delete */}
 <div className="flex flex-wrap gap-2 w-full"> {categories.map((c) => (
 <div key={c.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"> {editingCatId === c.id ? (
 /* INLINE EDIT ROW */
 <div className="flex flex-col gap-2 px-2 py-2 min-w-[200px]"> <div className="flex items-center gap-1.5"> <input
 value={editCatName}
 onChange={(e) => setEditCatName(e.target.value)}
 className="flex-1 bg-slate-50 border border-slate-200 px-2 py-1 rounded text-xs font-semibold text-slate-700 uppercase outline-none focus:ring-1 focus:ring-emerald-400"
 placeholder="Name"
 /> <button
 onClick={() => handleSaveEditCategory(c)}
 className="text-emerald-600 hover:text-emerald-800 text-xs font-bold cursor-pointer px-1"
 title="Save"
 ></button> <button
 onClick={() => setEditingCatId(null)}
 className="text-slate-400 hover:text-slate-600 text-xs cursor-pointer px-1"
 title="Cancel"
 ></button> </div> <div className="flex gap-1.5"> <button
 type="button"
 onClick={() => setEditCatImageMode('emoji')}
 className={`flex-1 text-center py-0.5 rounded text-[10px] font-semibold border cursor-pointer transition-all ${editCatImageMode ==='emoji' ?'bg-white border-slate-700 text-slate-800' :'bg-slate-100 border-transparent text-slate-400 hover:bg-slate-200'}`}
 > Emoji</button> <button
 type="button"
 onClick={() => setEditCatImageMode('picture')}
 className={`flex-1 text-center py-0.5 rounded text-[10px] font-semibold border cursor-pointer transition-all ${editCatImageMode ==='picture' ?'bg-white border-slate-700 text-slate-800' :'bg-slate-100 border-transparent text-slate-400 hover:bg-slate-200'}`}
 > Image</button> </div> {editCatImageMode ==='emoji' ? (
 <div className="flex items-center gap-1.5"> <input
                                value={editCatEmoji}
                                onChange={(e) => setEditCatEmoji(e.target.value)}
 maxLength={8}
 className="w-10 text-center bg-slate-50 border border-slate-200 rounded text-base outline-none focus:ring-1 focus:ring-emerald-400 py-0.5"
 placeholder=""
 /> <span className="text-[10px] text-slate-400">Paste emoji</span> </div> ) : (
 <div className="flex items-center gap-1.5"> <input
 type="url"
 value={editCatImageUrl}
 onChange={(e) => setEditCatImageUrl(e.target.value)}
 placeholder="https://... image URL"
 className="flex-1 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded text-[10px] text-slate-600 outline-none focus:ring-1 focus:ring-emerald-400"
 /> {editCatImageUrl.trim() && (
 <img src={editCatImageUrl} alt="preview" className="w-6 h-6 object-contain rounded border border-slate-200 bg-white" onError={(e) => (e.currentTarget.style.display ='none')} /> )}
 </div> )}
 </div> ) : (
 /* DISPLAY ROW */
 <div className="flex items-center gap-1.5 px-2.5 py-1.5"> {/* Icon: image or emoji */}
 {c.imageUrl ? (
 <img src={c.imageUrl} alt={c.name} className="w-5 h-5 object-contain rounded" onError={(e) => (e.currentTarget.style.display ='none')} /> ) : (
                            <span className="text-base">{c.emoji}</span> )}
 <span className={`uppercase text-xs font-semibold ${c.isVisible === false ?'text-slate-400 line-through' :'text-slate-700'}`}> {c.name}
 </span> {/* Visibility toggle */}
 <button
 onClick={() => handleToggleCategoryVisibility(c)}
 title={c.isVisible === false ?'Hidden — click to show' :'Visible — click to hide'}
 className={`text-[10px] font-bold px-1.5 py-0.5 rounded cursor-pointer transition-colors ${c.isVisible === false ?'bg-slate-100 text-slate-400 hover:bg-amber-50 hover:text-amber-600' :'bg-emerald-50 text-emerald-600 hover:bg-red-50 hover:text-red-500'}`}
 > {c.isVisible === false ?'HIDDEN' :'LIVE'}
 </button> {/* Navbar pin toggle */}
 <button
 onClick={() => handleToggleNavbarFeatured(c)}
 title={c.isNavbarFeatured ?'Pinned in navbar — click to unpin' :'Not in navbar — click to pin'}
 className={`text-[10px] font-bold px-1.5 py-0.5 rounded cursor-pointer transition-colors ${c.isNavbarFeatured ?'bg-indigo-50 text-indigo-600 hover:bg-rose-50 hover:text-rose-500' :'bg-slate-100 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600'}`}
 > {c.isNavbarFeatured ?' NAV' :' PIN'}
 </button> {/* Edit */}
 <button
 onClick={() => handleStartEditCategory(c)}
 className="text-slate-400 hover:text-blue-600 cursor-pointer text-[11px] transition-colors"
 title="Edit category"
 ></button> {/* Delete */}
 <button
 onClick={() => handleDeleteCategory(c.id, c.name)}
 className="text-slate-400 hover:text-rose-600 transition-colors cursor-pointer text-[10px]"
 title="Delete category"
 ></button> </div> )}
 </div> ))}
 </div> <p className="text-[10px] text-slate-400 font-medium"> Tip: <strong>LIVE/HIDDEN</strong> toggles storefront visibility. <strong> PIN/NAV</strong> controls which categories show in the navbar — pin up to 5 for a clean header. <strong>Logo Image URL</strong> overrides the emoji icon in the navbar and filter bar. Click to edit.
 </p> </div> {/* Table Products listings */}
 <div className="overflow-x-auto border border-slate-200 rounded-xl scrollbar-thin shadow-sm"><table className="w-full border-collapse text-left text-xs text-slate-700 bg-white"><thead><tr className="bg-slate-900 text-white font-sans uppercase font-semibold tracking-wider text-[10px]"><th className="p-3">Item</th><th className="p-3">Category</th><th className="p-3">Price</th><th className="p-3">Active Stock</th><th className="p-3 text-center">Featured</th><th className="p-3 text-right">Actions</th></tr></thead><tbody>{products.map((p) => {
 const isLowStock = p.stock > 0 && p.stock < 10;
 const isOutOfStock = p.stock <= 0;
 return (
 <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/50"><td className="p-3 font-semibold flex items-center gap-2.5"> {p.image.startsWith('http') || p.image.startsWith('data:') || p.image.startsWith('/') ? (
 <img
                                src={p.image}
 alt={p.name}
 className="w-8 h-8 object-cover rounded-md border border-slate-100 bg-slate-50 shrink-0"
 onError={(e) => { (e.target as HTMLImageElement).style.display ='none'; }}
 /> ) : (
                              <span className="text-lg bg-slate-50 border border-slate-100 p-1.5 rounded-md shrink-0">{p.image}</span> )}
 <span className="truncate uppercase font-bold max-w-[150px] text-slate-800">{p.name}</span></td><td className="p-3 font-semibold uppercase text-slate-500">{p.category}</td><td className="p-3 font-bold text-slate-800"> <span>{formatPrice(p.salePrice || p.price)}</span> {p.salePrice !== null && (
 <span className="text-[10px] text-slate-400 line-through ml-1">{formatPrice(p.price)}</span> )}
 </td><td className="p-3"> {isOutOfStock ? (
 <span className="bg-slate-100 text-slate-400 font-bold px-1.5 py-0.5 rounded uppercase text-[9px]">OUT</span> ) : isLowStock ? (
 <span className="bg-red-50 text-red-700 font-bold px-1.5 py-0.5 rounded text-[9px] animate-pulse"> LOW ({p.stock})
 </span> ) : (
 <span className="bg-emerald-50 text-emerald-700 font-bold px-1.5 py-0.5 rounded text-[9px]"> {p.stock} units
 </span> )}
 </td><td className="p-3 text-center text-sm"> {p.isFeatured ?'' :'—'}
 </td><td className="p-3 text-right space-x-1"> <button
 onClick={() => handleOpenProductForm(p)}
 className="p-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 text-slate-600 cursor-pointer"
 title="Edit product parameters"
 > <Edit2 className="w-3.5 h-3.5" /> </button> <button
 onClick={() => handleDeleteProduct(p.id, p.name)}
 className="p-1.5 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-100 text-rose-600 cursor-pointer"
 title="Delete catalog index"
 > <Trash2 className="w-3.5 h-3.5" /> </button></td></tr> );
 })}
 </tbody></table> </div> </div> )}

 {/* TAB 2: ORDERS LIST tracker */}
 {activeTab ==='orders' && (
 <div className="space-y-6"> <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"> <div> <h3 className="text-lg font-bold text-slate-800 uppercase">Incoming Client Orders List</h3> <p className="text-xs text-slate-500 font-medium">Verify reference indices, update delivery states, or print receipts.</p> </div> {orders.length > 0 && (
 <button
 onClick={() => exportOrdersCSV(orders)}
 className="flex items-center gap-1.5 px-3 py-2 border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg text-xs font-bold uppercase transition-colors cursor-pointer shadow-xs flex-shrink-0"
 > <Download className="w-3.5 h-3.5" /> Export CSV
 </button> )}
 </div> {orders.length === 0 ? (
 <div className="bg-slate-50 p-8 rounded-xl font-semibold text-center text-slate-400 border border-slate-100"> No orders placed in records database yet.
 </div> ) : (
 <div className="space-y-4"> {orders.map((o) => (
 <div
 key={o.id}
 className="bg-white border border-slate-200 p-5 rounded-xl shadow-xs space-y-3"
 > {/* Accordion header card details */}
 <div className="flex flex-col sm:flex-row gap-2 items-center justify-between border-b border-slate-100 pb-2"> <div className="flex flex-wrap items-center gap-2"> {/* Suffix editor trigger */}
 {selectedOrderIdToEdit === o.id ? (
 <div className="flex items-center gap-1.5"> <input
 type="text"
 value={tempOrderNumber}
 onChange={(e) => setTempOrderNumber(e.target.value)}
 className="border border-slate-200 bg-white rounded-lg px-2 py-0.5 text-xs font-semibold text-slate-800 w-28 capitalize"
 /> <button
 onClick={() => handleSaveOrderNumber(o.id)}
 className="bg-emerald-50 text-emerald-600 p-1 border border-emerald-200 rounded-lg text-xs"
 > <Check className="w-3.5 h-3.5" /> </button> <button
 onClick={() => setSelectedOrderIdToEdit(null)}
 className="bg-rose-50 text-rose-600 p-1 border border-rose-200 rounded-lg text-xs"
 > </button> </div> ) : (
 <span
 onClick={() => {
 setSelectedOrderIdToEdit(o.id);
 setTempOrderNumber(o.orderNumber);
 }}
 className="text-xs font-bold text-slate-700 hover:text-emerald-600 cursor-pointer border border-slate-200 bg-slate-50 px-2.5 py-0.5 rounded-md"
 title="Click to override order indices or suffix values"
 > #{o.orderNumber}
 </span> )}

 <span className="text-[10px] text-slate-400 font-bold">{new Date(o.createdAt).toLocaleString()}</span> </div> {/* Dropdown status update buttons */}
 <div className="flex flex-wrap items-center gap-1.5 leading-none"> <label className="text-[10px] font-bold uppercase text-slate-400 mr-1.5">Delivery Status:</label> <select
 value={o.orderStatus}
 onChange={(e) => updateOrderStatus(o.id, e.target.value as any)}
 className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase text-slate-700 cursor-pointer focus:ring-1 focus:ring-emerald-400"
 > <option value="Pending" className="text-slate-900 bg-white font-medium">Pending</option> <option value="Processing" className="text-slate-900 bg-white font-medium">Processing</option> <option value="Confirmed" className="text-slate-900 bg-white font-medium">Confirmed</option> <option value="Shipped" className="text-slate-900 bg-white font-medium">Shipped</option> <option value="Delivered" className="text-slate-900 bg-white font-medium">Delivered</option> <option value="Cancelled" className="text-slate-900 bg-white font-medium">Cancelled</option> <option value="Refunded" className="text-slate-900 bg-white font-medium">Refunded</option> </select> <label className="text-[10px] font-bold uppercase text-slate-400 ml-2.5">Billed:</label> <select
 value={o.paymentStatus}
 onChange={(e) => updateOrderPaymentStatus(o.id, e.target.value as any)}
 className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase text-slate-700 cursor-pointer focus:ring-1 focus:ring-emerald-400"
 > <option value="Pending" className="text-slate-900 bg-white font-medium">Unpaid (COD)</option> <option value="Paid" className="text-slate-900 bg-white font-medium">Paid (Confirmed)</option> </select> <button
 onClick={() => {
 triggerConfirm(
'Destroy Order Registry',
`This will permanently delete the invoice record of Order #${o.orderNumber} for ${o.customerName}. This action is irreversible.`,
 async () => {
 await deleteOrder(o.id);
 toast.info(`Order #${o.orderNumber} record destroyed.`);
 }
 );
 }}
 className="p-1.5 hover:text-rose-605 border border-slate-200 rounded-md cursor-pointer ml-2 bg-slate-50 text-slate-400 hover:border-rose-100"
 title="Purge transaction history row"
 > <Trash2 className="w-3.5 h-3.5" /> </button> </div> </div> {/* Items grid info column breakdown */}
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-medium"> <div> <p className="text-[10px] text-slate-400 font-bold uppercase">Recipient Delivery Details</p> <p className="font-bold text-slate-800 mt-1">{o.customerName}</p> <p className="text-slate-500">Tel: {o.phone}</p> <p className="text-slate-500">Email: {o.email}</p> <p className="text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-100 mt-1.5 leading-snug"> {o.address}, {o.city} {o.postalCode ?`[ZIP:${o.postalCode}]` :''}
 </p> </div> <div> <p className="text-[10px] text-slate-400 font-bold uppercase">Products purchased</p> <ul className="space-y-1 mt-1 font-semibold text-slate-700 uppercase"> {o.items.map((it, idx) => (
 <li key={idx} className="flex gap-1.5"> <span className="text-emerald-500"></span> <span>{it.quantity}x {it.name} ({formatPrice(it.price)})</span> </li> ))}
 </ul> {o.deliveryNote && (
 <p className="text-[10px] italic text-emerald-600 font-semibold mt-1.5">Note:"{o.deliveryNote}"</p> )}
 </div> <div> <p className="text-[10px] text-slate-400 font-bold uppercase">Financial calculation</p> <p className="mt-1 text-slate-600">Subtotal: {formatPrice(o.subtotal)}</p> {o.discount > 0 && <p className="text-rose-600 font-semibold">Discount: -{formatPrice(o.discount)}</p>}
 <p className="text-slate-600">Delivery Fee: {formatPrice(o.deliveryFee)}</p> <p className="font-bold text-sm text-emerald-600 mt-1 border-t border-slate-100 pt-1"> GRAND TOTAL: {formatPrice(o.total)}
 </p> <p className="text-[9px] uppercase tracking-wider text-slate-400 font-bold mt-1"> Paid via: {o.paymentMethod}
 </p> </div> </div> </div> ))}
 </div> )}
 </div> )}

 {/* TAB 3: COUPONS ENGINE Setup */}
 {activeTab ==='coupons' && (
 <div className="space-y-6"> <div className="flex items-center justify-between border-b border-slate-100 pb-4"> <div> <h3 className="text-lg font-bold text-slate-800 uppercase">Promo Code Coupons setup</h3> <p className="text-xs text-slate-500 font-medium">Configure active checkouts discount percentages.</p> </div> <button
 onClick={() => setIsCouponFormOpen(!isCouponFormOpen)}
 className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-sans font-semibold uppercase text-xs rounded-lg shadow-sm cursor-pointer"
 > {isCouponFormOpen ?'Close Form' :'+ Add Coupon'}
 </button> </div> {isCouponFormOpen && (
 <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl"> <h4 className="text-xs font-bold uppercase text-slate-700 mb-3">Add Custom Promo Code</h4> <form onSubmit={handleCreateCoupon} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"> <div> <label className="block text-[9px] font-bold uppercase text-slate-500 mb-1">Coupon Code *</label> <input
 type="text"
 required
 value={coupCode}
 onChange={(e) => setCoupCode(e.target.value)}
 placeholder="e.g. SAVINGS20"
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 text-xs font-semibold py-1.5 uppercase outline-none focus:ring-1 focus:ring-emerald-400"
 /> </div> <div> <label className="block text-[9px] font-bold uppercase text-slate-500 mb-1">Discount (%) *</label> <input
 type="number"
 min="1"
 max="100"
 required
 value={coupDiscount}
 onChange={(e) => setCoupDiscount(Number(e.target.value))}
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 text-xs font-semibold py-1.5 outline-none focus:ring-1 focus:ring-emerald-400"
 /> </div> <div> <label className="block text-[9px] font-bold uppercase text-slate-500 mb-1">Expiry Date *</label> <input
 type="date"
 required
 value={coupExpiry}
 onChange={(e) => setCoupExpiry(e.target.value)}
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 text-xs font-semibold py-1 outline-none focus:ring-1 focus:ring-emerald-400"
 /> </div> <div> <label className="block text-[9px] font-bold uppercase text-slate-500 mb-1">Usage Limit *</label> <input type="number" min="1" required value={coupLimit} onChange={(e) => setCoupLimit(Number(e.target.value))} placeholder="e.g. 100" className="w-full bg-white border border-slate-200 rounded-lg px-2.5 text-xs font-semibold py-1.5 outline-none focus:ring-1 focus:ring-emerald-400" /> </div> <button
 type="submit"
 className="w-full cursor-pointer py-1.5 hover:bg-emerald-700 bg-emerald-600 text-white rounded-lg text-xs font-semibold uppercase transition-colors shadow-sm"
 > Create Promo
 </button> </form> </div> )}

 {coupons.length === 0 ? (
 <div className="font-semibold text-slate-400 text-center py-6 bg-slate-50 border rounded-xl"> No active coupon campaigns configured.
 </div> ) : (
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"> {coupons.map((c) => (
 <div
 key={c.id}
 className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex items-center justify-between hover:border-slate-300 transition-all"
 > <div> <h4 className="text-xs font-bold text-slate-800 uppercase flex items-center gap-1.5"> <span>Code:</span> <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-mono font-bold border border-emerald-100">{c.code}</span> </h4> <p className="text-xs text-slate-500 font-bold mt-1.5">Discount Rate: {c.discountPercentage}% OFF</p> <p className="text-[10px] text-slate-400 mt-1 uppercase">Limits: {c.usedCount} / {c.usageLimit} uses</p> <p className="text-[10px] text-slate-400 uppercase mt-0.5">Expires on: {c.expiryDate}</p> </div> <button
 onClick={() => {
 triggerConfirm(
 'Purge Promo Coupon',
 `Are you sure you want to disable and delete the discount coupon code "${c.code}" immediately? Users will no longer be able to use it at checkout.`,
 async () => {
 try {
 if (getIsFirebaseConfigured()) {
 await dbService.deleteCoupon(c.id);
 } else {
 await deleteCoupon(c.id);
 }
 toast.info(`Purged coupon "${c.code}".`);
 } catch (err) {
 console.error('[AdminPanel] Coupon delete error:', err);
 toast.error('Failed to delete coupon. ' + (err instanceof Error ? err.message : ''));
 }
 }
 );
 }}
 className="p-2 border border-rose-300 hover:bg-rose-100 rounded-xl cursor-pointer text-rose-700"
 title="Delete promo parameter row"
 > <Trash2 className="w-4 h-4" /> </button> </div> ))}
 </div> )}
 </div> )}

 {/* TAB 4: REVIEWS MODERATION LIST */}
 {activeTab ==='reviews' && (
 <div className="space-y-6"> <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4 border-slate-200"> <div> <h3 className="text-lg font-bold text-slate-800 uppercase">Product Star Rating Reviews Moderation</h3> <p className="text-xs text-slate-500 font-medium">Verify submissions, approve content, or reject comments.</p> </div> {reviews.length > 0 && (
<>
 <button
 type="button"
 onClick={() => {
 triggerConfirm(
'Purge Absolutely All Reviews',
'WARNING: This will instantly delete and wipe every single review comment on your website database! This action is irreversible.',
 async () => {
 for (const r of reviews) {
 await deleteReview(r.id);
 }
 toast.success('All reviews purged.');
 }
 );
 }}
 className="px-3.5 py-2 cursor-pointer bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold uppercase tracking-wide shadow-sm transition-all self-end sm:self-auto"
 > Purge All Reviews
 </button>
 </>
 )}
 </div> {/* NEW SUB-PANEL: ADD CUSTOM REVIEW */}
 <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4 shadow-xs"> <div className="flex items-center justify-between border-b pb-2 border-slate-200"> <h4 className="text-xs font-extrabold uppercase text-slate-700 flex items-center gap-1.5"> Create & Inject Custom Review
 </h4> <span className="text-[9px] bg-slate-900 text-white rounded px-2 py-0.5 font-bold uppercase">Admin Verified</span> </div> <form
 onSubmit={async (e) => {
 e.preventDefault();
 if (!newReviewProdId) {
 toast.error("Please select a target product!");
 return;
 }
 if (!newReviewAuthor.trim()) {
 toast.error("Please supply a reviewer name!");
 return;
 }
 if (!newReviewComment.trim()) {
 toast.error("Please supply review comment text!");
 return;
 }
 try {
 await addReview(newReviewProdId, newReviewAuthor.trim(), newReviewRating, newReviewComment.trim());
 toast.success('Review added successfully.');
 setNewReviewAuthor('');
 setNewReviewComment('');
 } catch (err) {
 toast.error("Failure writing target review comment.");
 }
 }}
 className="space-y-4"
 > <div className="grid grid-cols-1 md:grid-cols-12 gap-4"> <div className="md:col-span-5"> <label className="block text-[9px] font-extrabold uppercase text-slate-500 mb-1">Target Product Listing *</label> <select
 required
 value={newReviewProdId}
 onChange={(e) => setNewReviewProdId(e.target.value)}
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:ring-1 focus:ring-emerald-500 outline-none cursor-pointer"
 > <option value="">-- SELECT PRODUCT CATALOG ITEM --</option> {products.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option> ))}
 </select> </div> <div className="md:col-span-4"> <label className="block text-[9px] font-extrabold uppercase text-slate-500 mb-1">Reviewer Name *</label> <input
 type="text"
 required
 placeholder="e.g. Maria S."
 value={newReviewAuthor}
 onChange={(e) => setNewReviewAuthor(e.target.value)}
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 outline-none font-medium focus:ring-1 focus:ring-emerald-400"
 /> </div> <div className="md:col-span-3"> <label className="block text-[9px] font-extrabold uppercase text-slate-500 mb-1">Star Score *</label> <select
 value={newReviewRating}
 onChange={(e) => setNewReviewRating(Number(e.target.value))}
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-900 focus:ring-1 focus:ring-emerald-400 outline-none cursor-pointer"
 > <option value={5}> (5 Stars)</option> <option value={4}> (4 Stars)</option> <option value={3}> (3 Stars)</option> <option value={2}> (2 Stars)</option> <option value={1}> (1 Star)</option> </select> </div> </div> <div> <label className="block text-[9px] font-extrabold uppercase text-slate-500 mb-1">Reviewer Comment Text *</label> <textarea
 required
 placeholder="Organic, fresh, highly recommended! Quick shipping and incredibly rich texture."
 value={newReviewComment}
 onChange={(e) => setNewReviewComment(e.target.value)}
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-400 outline-none h-16"
 /> </div> <div className="flex justify-end pt-1"> <button
 type="submit"
 className="cursor-pointer bg-slate-900 hover:bg-slate-950 border border-transparent px-5 py-2 text-white text-xs font-sans font-extrabold uppercase tracking-wide rounded-lg shadow-xs transition-colors"
 > + Inject & Approve Review
 </button> </div> </form> </div> {reviews.length === 0 ? (
 <div className="p-8 text-center text-slate-400 font-semibold bg-slate-50 rounded-xl border border-slate-100"> No submission ratings stored in database index yet.
 </div> ) : (
 <div className="space-y-4"> {reviews.map((r) => {
 const mappedItem = products.find((p) => p.id === r.productId);
 return (
 <div
 key={r.id}
 className="bg-white border border-slate-200 p-4 rounded-xl flex flex-col sm:flex-row gap-4 justify-between items-start shadow-sm hover:border-slate-300 transition-all"
 > <div className="flex-1 space-y-1"> <div className="flex items-center gap-1.5"> <span className="text-xs font-bold text-slate-700 uppercase">{r.reviewerName}</span> <span className="text-[10px] text-slate-400 font-bold">({new Date(r.createdAt || Date.now()).toLocaleDateString()})</span> {r.isApproved ? (
 <span className="text-[8px] bg-emerald-50 text-emerald-800 border border-emerald-300 rounded font-bold uppercase px-1.5 py-0.5">APPROVED</span> ) : (
 <span className="text-[8px] bg-amber-50 text-amber-800 border border-amber-300 rounded font-bold uppercase px-1.5 py-0.5 animate-pulse">PENDING IN BOX</span> )}
 </div> <div className="flex text-amber-400"> {Array.from({ length: r.rating }).map((_, i) => (
 <Star key={i} className="w-4 h-4 fill-amber-350 stroke-amber-400" /> ))}
 </div> <p className="text-xs text-slate-500 italic font-semibold leading-relaxed">
"{r.comment}"
 </p> {mappedItem && (
 <p className="text-[9px] text-[#ff5c35] font-bold uppercase mt-1"> Linked listing item: {mappedItem.name}
 </p> )}
 </div> <div className="flex gap-1.5"> {!r.isApproved && (
 <button
 onClick={async () => {
 await approveReview(r.id, true);
 toast.success('Review approved and live on testimonials.');
 }}
 className="px-3 py-1.5 cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold uppercase rounded-lg shadow-sm transition-colors"
 > Approve
 </button> )}
 <button
 onClick={() => {
 triggerConfirm(
'Purge Review Rating Comment',
`Are you sure you want to permanently delete the review comment from"${r.reviewerName}"? This action will immediately adjust product star counts.`,
 async () => {
 await deleteReview(r.id);
 toast.info('Destroyed review comment.');
 }
 );
 }}
 className="px-3 py-1.5 hover:bg-rose-50 border border-rose-200 rounded-lg text-rose-600 text-[10px] uppercase font-semibold transition-colors"
 title="Delete comment rating"
 > Purge
 </button> </div> </div> );
 })}
 </div> )}
 </div> )}

 {/* TAB 5: SUBSCRIBERS TABLE */}
 {activeTab ==='subscribers' && (
 <div className="space-y-6"> <div> <h3 className="text-lg font-bold text-slate-800 uppercase">Newsletter Subscribers</h3> <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Subscribers Count: {newsletterSubscribers.length}</p> </div> {newsletterSubscribers.length === 0 ? (
 <div className="p-8 text-center text-slate-400 font-semibold bg-slate-50 rounded-xl border border-slate-100"> No active subscribers registered yet.
 </div> ) : (
 <div className="space-y-4"> {/* Subscriber CSV list utility */}
 <div className="bg-slate-50 p-3 rounded-lg border border-dashed border-slate-200 text-[10px] font-semibold text-slate-600 uppercase select-all break-all cursor-copy"> CSV EXPORT: {newsletterSubscribers.map(sub => sub.email).join(',')}
 </div> <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm"><table className="w-full border-collapse text-left text-xs bg-white text-slate-700"><thead><tr className="bg-slate-900 border-b border-slate-200 text-[10px] font-bold uppercase text-white"><th className="p-3">Subscriber Address (Email)</th><th className="p-3">Subscribed date</th><th className="p-3 text-right">Delete</th></tr></thead><tbody>{newsletterSubscribers.map((item) => (
 <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50"><td className="p-3 font-semibold text-slate-800">{item.email}</td><td className="p-3 font-semibold text-slate-400">{new Date(item.subscribedAt).toLocaleString()}</td><td className="p-3 text-right"> <button
 onClick={() => {
 triggerConfirm(
'Remove Subscriber Record',
`Are you sure you want to permanently remove the subscriber"${item.email}" from your email marketing database index?`,
 async () => {
 await deleteSubscriber(item.id);
 toast.info(`Subscriber"${item.email}" wiped from marketing database.`);
 }
 );
 }}
 className="p-1.5 text-slate-400 hover:text-rose-600 rounded cursor-pointer transition-colors"
 > </button></td></tr> ))}
 </tbody></table> </div> </div> )}
 </div> )}

 {/* TAB 5.5: PAGE SECTIONS (NEWSLETTER & TESTIMONIALS) */}
 {activeTab ==='sections' && (
 <div className="space-y-6">
 <div>
 <h3 className="text-lg font-bold text-slate-800 uppercase mb-2">Customize Page Sections</h3>
 <p className="text-xs text-slate-500 font-medium mb-6">Edit the Newsletter Registration and Client Testimonials sections below. Changes are saved to Firebase and appear instantly on your website.</p>
 </div>
 <AdminSectionSettings />
 </div>
 )}

 {/* TAB 6: GLOBAL CMS SITE SETTINGS MULTI SECTIONS */}
 {activeTab ==='settings' && (
 <div className="space-y-6"> {/* Settings segment selectors */}
 <div className="flex flex-wrap gap-1.5 border-b pb-4 mb-4 select-none border-slate-100"> <button
 onClick={() => setSettingsSection('general')}
 className={`px-3.5 py-1.5 rounded-lg text-[10px] font-bold uppercase cursor-pointer transition-all ${
 settingsSection ==='general'
 ?'bg-emerald-600 text-white shadow-sm'
 :'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
 }`}
 > Site Branding
 </button> <button
 onClick={() => setSettingsSection('smtp')}
 className={`px-3.5 py-1.5 rounded-lg text-[10px] font-bold uppercase cursor-pointer transition-all ${
 settingsSection ==='smtp'
 ?'bg-emerald-600 text-white shadow-sm'
 :'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
 }`}
 > SMTP Mail keys
 </button> <button
 onClick={() => setSettingsSection('sms')}
 className={`px-3.5 py-1.5 rounded-lg text-[10px] font-bold uppercase cursor-pointer transition-all ${
 settingsSection ==='sms'
 ?'bg-emerald-600 text-white shadow-sm'
 :'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
 }`}
 > SMS & Verify
 </button> <button
 onClick={() => setSettingsSection('payment')}
 className={`px-3.5 py-1.5 rounded-lg text-[10px] font-bold uppercase cursor-pointer transition-all ${
 settingsSection ==='payment'
 ?'bg-emerald-600 text-white shadow-sm'
 :'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
 }`}
 > Checkout channels
 </button> <button
 onClick={() => setSettingsSection('support')}
 className={`px-3.5 py-1.5 rounded-lg text-[10px] font-bold uppercase cursor-pointer transition-all ${
 settingsSection ==='support'
 ?'bg-emerald-600 text-white shadow-sm'
 :'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
 }`}
 > Live Support Chat
 </button> <button
 onClick={() => setSettingsSection('security')}
 className={`px-3.5 py-1.5 rounded-lg text-[10px] font-bold uppercase cursor-pointer transition-all ${
 settingsSection ==='security'
 ?'bg-emerald-600 text-white shadow-sm'
 :'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
 }`}
 > credentials keys
 </button> <button
 onClick={() => setSettingsSection('delivery')}
 className={`px-3.5 py-1.5 rounded-lg text-[10px] font-bold uppercase cursor-pointer transition-all ${
 settingsSection ==='delivery'
 ?'bg-emerald-600 text-white shadow-sm'
 :'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
 }`}
 > Delivery Zones
 </button>
 </div> {/* SECTION: GENERAL BRANDING SETTINGS */}
 {settingsSection ==='general' && (
 <div className="space-y-4"> <h4 className="text-xs font-bold uppercase text-slate-400"> STOREFRONT BRANDING PROVISIONS</h4> <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Website Title Name</label> <input
 type="text"
 value={brandName}
 onChange={(e) => setBrandName(e.target.value)}
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> </div> <div className="md:col-span-2"> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5"> Site Logo Image <span className="normal-case text-emerald-600 font-semibold">(appears in Navbar, Footer, Hero, Cart & Invoices)</span> </label> {/* Recommended size info box */}
 <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-[10px] text-blue-800 leading-relaxed mb-3"> <p className="font-bold text-blue-900 uppercase mb-1"> Recommended Logo Specifications</p> <div className="grid grid-cols-2 gap-x-4 gap-y-0.5"> <p>• Ideal size: <span className="font-bold">200 × 200 px</span> (square)</p> <p>• Aspect ratio: <span className="font-bold">1:1 square</span></p> <p>• Min size: <span className="font-bold">100 × 100 px</span></p> <p>• Max file size: <span className="font-bold">2 MB</span></p> <p>• Best format: <span className="font-bold">SVG or PNG</span></p> <p>• Background: <span className="font-bold">Transparent PNG preferred</span></p> </div> <p className="mt-1.5 text-blue-700"> SVG is best — scales perfectly at any size. Transparent PNG also works great. Avoid JPG for logos (no transparency).</p> </div> <div className="flex flex-col sm:flex-row gap-3 items-start"> {/* Upload button */}
 <div className="flex-1 space-y-2"> <label className="flex items-center gap-2 w-fit px-3 py-2 bg-white border border-dashed border-emerald-400 hover:bg-emerald-50 rounded-xl cursor-pointer transition-colors group"> <span className="text-emerald-600 text-lg"></span> <span className="text-xs font-semibold text-emerald-700 group-hover:text-emerald-800">Upload Logo File</span> <input
 type="file"
 accept="image/jpeg,image/png,image/webp,image/svg+xml,image/gif"
 onChange={handleLogoFileUpload}
 className="hidden"
 /> </label> <div> <label className="block text-[9px] font-bold uppercase text-slate-400 mb-1">— or paste logo URL</label> <input
 type="url"
 value={brandLogoUrl.startsWith('data:') ?'' : brandLogoUrl}
 onChange={(e) => {
 setBrandLogoUrl(e.target.value);
 setBrandLogoPreview(e.target.value);
 setBrandLogoUploadError('');
 }}
 placeholder="https://yourdomain.com/logo.png"
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> </div> {brandLogoUploadError && (
 <p className="text-[10px] text-rose-600 font-semibold bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5"> {brandLogoUploadError}
 </p> )}
 </div> {/* Live preview */}
 <div className="flex-shrink-0"> <p className="text-[9px] font-bold uppercase text-slate-400 mb-1.5">Live Preview</p> <div className="w-20 h-20 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center overflow-hidden"> {brandLogoPreview ? (
 <img
 src={brandLogoPreview}
 alt="Logo preview"
 className="w-full h-full object-contain p-1"
 onError={() => {
 setBrandLogoUploadError('Cannot load image from this URL.');
 setBrandLogoPreview('');
 }}
 /> ) : (
 <span className="text-slate-300 text-xs font-medium text-center leading-tight">No logo</span> )}
 </div> {brandLogoPreview && (
 <button
 type="button"
 onClick={() => { setBrandLogoUrl(''); setBrandLogoPreview(''); }}
 className="mt-1.5 text-[9px] text-rose-500 hover:text-rose-700 font-bold cursor-pointer w-full text-center"
 > Remove logo
 </button> )}
 </div> </div> </div> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1"> Browser Tab Title <span className="normal-case text-emerald-600 font-semibold">(appears in browser tab & search results)</span> </label> <input
 type="text"
 value={siteTitle}
 onChange={(e) => setSiteTitle(e.target.value)}
 placeholder="e.g. Fruitopia — Fresh Organic Smoothies & Juices"
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> <p className="text-[9px] text-slate-400 font-medium mt-1"> This updates the <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600">&lt;title&gt;</code> tag instantly. Keep it under 60 characters for best SEO.
 </p> </div> <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Hero Badge Text</label> <input
 type="text"
 value={heroBadgeText}
 onChange={(e) => setHeroBadgeText(e.target.value)}
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Hero Store Hours Label</label> <input
 type="text"
 value={heroHours}
 onChange={(e) => setHeroHours(e.target.value)}
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> </div> </div> <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Hero Display Title - Segment 1</label> <input
 type="text"
 value={heroLine1}
 onChange={(e) => setHeroLine1(e.target.value)}
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Hero Display Title - Segment 2</label> <input
 type="text"
 value={heroLine2}
 onChange={(e) => setHeroLine2(e.target.value)}
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> </div> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Hero Subtitle Paragraph Description</label> <textarea
 rows={2}
 value={heroSubText}
 onChange={(e) => setHeroSubText(e.target.value)}
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold resize-none outline-none transition-all"
 ></textarea> </div> <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Hero Order Button Label Texts</label> <input
 type="text"
 value={heroBtnText}
 onChange={(e) => setHeroBtnText(e.target.value)}
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Footer Copyright Trademark phrase</label> <input
 type="text"
 value={trademarkTextVal}
 onChange={(e) => setTrademarkTextVal(e.target.value)}
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> </div> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Footer Brand Tagline <span className="normal-case font-normal text-slate-400">(short paragraph shown under the logo in the footer)</span></label> <textarea
 rows={2}
 value={footerCopy}
 onChange={(e) => setFooterCopy(e.target.value)}
 placeholder="e.g. quirky-fruity: serving dynamic organic fuel to nourish your daily vibrant self."
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold resize-none outline-none transition-all"
 ></textarea> </div> <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-100 pt-4"> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Branding Contact Mail</label> <input
 type="email"
 value={footerMail}
 onChange={(e) => setFooterMail(e.target.value)}
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Branding Contact Phone</label> <input
 type="text"
 value={footerPhone}
 onChange={(e) => setFooterPhone(e.target.value)}
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Branding Store Physical Location</label> <input
 type="text"
 value={footerLoc}
 onChange={(e) => setFooterLoc(e.target.value)}
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> </div> </div> <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-100 pt-4"> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Facebook URL</label> <input
 type="text"
 value={socialFB}
 onChange={(e) => setSocialFB(e.target.value)}
 placeholder="https://facebook.com/brand"
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Instagram URL</label> <input
 type="text"
 value={socialIG}
 onChange={(e) => setSocialIG(e.target.value)}
 placeholder="https://instagram.com/brand"
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Twitter/X URL</label> <input
 type="text"
 value={socialTW}
 onChange={(e) => setSocialTW(e.target.value)}
 placeholder="https://twitter.com/brand"
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> </div> </div> <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl p-3.5 space-y-3"> <div className="flex items-center gap-2"> <input
 type="checkbox"
 id="promo-en"
 checked={promoActive}
 onChange={(e) => setPromoActive(e.target.checked)}
 className="scale-110 accent-emerald-600 rounded cursor-pointer"
 /> <label htmlFor="promo-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700">Enable Header Announcement Promotion Banner</label> </div> {promoActive && (
 <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Announcement Promo Text Content</label> <input
 type="text"
 value={promoTextVal}
 onChange={(e) => setPromoTextVal(e.target.value)}
 placeholder="e.g. Grand Opening Special Promo: Save 20% on any Smoothie with SAVINGS20!"
 className="w-full bg-white border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold uppercase text-slate-800 outline-none"
 /> </div> )}
 </div> {/* Order Tracker Toggle */}
 <div className="bg-violet-50 border-2 border-dashed border-violet-200 rounded-xl p-3.5 space-y-3"> <div className="flex items-center gap-2"> <input
 type="checkbox"
 id="tracker-en"
 checked={orderTrackerEnabled}
 onChange={(e) => setOrderTrackerEnabled(e.target.checked)}
 className="scale-110 accent-violet-600 rounded cursor-pointer"
 /> <div> <label htmlFor="tracker-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700">Enable Order Tracker Page <span className="text-violet-600">(/tracker)</span></label> <p className="text-[9px] text-slate-400 mt-0.5">Customers can track their order status via QR code or order number. Disable to return 404 for /tracker.</p> </div> </div> {orderTrackerEnabled && (
 <div className="flex items-center gap-2 pl-1 pt-1 border-t border-violet-200"> <input
 type="checkbox"
 id="tracker-navbar"
 checked={orderTrackerInNavbar}
 onChange={(e) => setOrderTrackerInNavbar(e.target.checked)}
 className="scale-110 accent-violet-600 rounded cursor-pointer"
 /> <div> <label htmlFor="tracker-navbar" className="text-xs font-bold uppercase cursor-pointer text-slate-700">Show Tracker Link in Navbar</label> <p className="text-[9px] text-slate-400 mt-0.5">Displays a"Track Order" button in the top navigation bar for customers.</p> </div> </div> )}
  </div>
 <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
  <div>
    <label className="block text-[10px] font-extrabold text-slate-600 uppercase tracking-wider mb-0.5">Browser Tab Favicon</label>
    <p className="text-[9px] text-slate-400 font-medium">Upload your favicon directly from your device — or paste a URL as a fallback.</p>
    <p className="text-[9px] text-violet-600 font-semibold mt-0.5">Recommended: <strong>32×32px or 64×64px</strong> — PNG, ICO, or SVG with transparent background.</p>
  </div>
  <div className="flex items-center gap-2 flex-wrap">
    <label className="flex items-center gap-1.5 cursor-pointer px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-bold uppercase rounded-lg transition-colors flex-shrink-0 select-none">
      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12V4m0 0l-3 3m3-3l3 3"/></svg>
      Upload File
      <input type="file" accept="image/png,image/x-icon,image/svg+xml,image/jpeg,image/webp" className="sr-only" onChange={handleFaviconUpload} />
    </label>
    <span className="text-[9px] text-slate-400 font-semibold flex-shrink-0">or paste URL:</span>
    <input
      type="text"
      value={faviconUrl.startsWith('data:') ? '' : faviconUrl}
      onChange={(e) => setFaviconUrl(e.target.value)}
      placeholder="https://..."
      className="flex-1 min-w-[120px] bg-white border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs outline-none transition-all"
    />
    {faviconUrl && (
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <div className="w-9 h-9 rounded border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
          <img src={faviconUrl} alt="favicon" className="w-full h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }} />
        </div>
        <span className="text-[9px] font-bold text-emerald-600">✓ Set</span>
      </div>
    )}
  </div>
  {faviconUrl && (
    <button onClick={() => setFaviconUrl('')} className="text-[10px] text-slate-400 hover:text-rose-500 cursor-pointer">✕ Clear favicon</button>
  )}
</div> {/* CURRENCY SETTINGS */}
 <div className="pt-3 border-t border-slate-100 space-y-3"> <h5 className="text-[10px] font-bold uppercase text-slate-500 tracking-wider"> Currency</h5> <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Store Currency</label> <select
 value={selectedCurrency}
 onChange={(e) => {
 const found = [
 { code:'USD', symbol:'$', position:'before' },
 { code:'EUR', symbol:'€', position:'before' },
 { code:'GBP', symbol:'£', position:'before' },
 { code:'BDT', symbol:'৳', position:'before' },
 { code:'INR', symbol:'₹', position:'before' },
 { code:'AED', symbol:'د.إ', position:'after' },
 { code:'SAR', symbol:'﷼', position:'before' },
 { code:'PKR', symbol:'₨', position:'before' },
 { code:'MYR', symbol:'RM', position:'before' },
 { code:'CAD', symbol:'CA$', position:'before' },
 { code:'AUD', symbol:'A$', position:'before' },
 { code:'JPY', symbol:'¥', position:'before' },
 { code:'CNY', symbol:'¥', position:'before' },
 { code:'TRY', symbol:'₺', position:'before' },
 { code:'NGN', symbol:'₦', position:'before' },
 ].find(x => x.code === e.target.value);
 setSelectedCurrency(e.target.value);
 if (found) { setCustomSymbol(found.symbol); setCurrencyPosition(found.position as'before'|'after'); }
 }}
 className="w-full bg-white border border-slate-200 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 text-xs outline-none"
 > <option value="USD"> USD — US Dollar ($)</option> <option value="EUR"> EUR — Euro (€)</option> <option value="GBP"> GBP — British Pound (£)</option> <option value="BDT"> BDT — Bangladeshi Taka (৳)</option> <option value="INR"> INR — Indian Rupee (₹)</option> <option value="AED"> AED — UAE Dirham (د.إ)</option> <option value="SAR"> SAR — Saudi Riyal (﷼)</option> <option value="PKR"> PKR — Pakistani Rupee (₨)</option> <option value="MYR"> MYR — Malaysian Ringgit (RM)</option> <option value="CAD"> CAD — Canadian Dollar (CA$)</option> <option value="AUD"> AUD — Australian Dollar (A$)</option> <option value="JPY"> JPY — Japanese Yen (¥)</option> <option value="TRY"> TRY — Turkish Lira (₺)</option> <option value="NGN"> NGN — Nigerian Naira (₦)</option> </select> </div> <div className="flex gap-2"> <div className="flex-1"> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Symbol Override</label> <input
 type="text"
 value={customSymbol}
 onChange={(e) => setCustomSymbol(e.target.value)}
 placeholder="$"
 className="w-full bg-white border border-slate-200 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 text-xs outline-none"
 /> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Position</label> <select
 value={currencyPosition}
 onChange={(e) => setCurrencyPosition(e.target.value as'before'|'after')}
 className="bg-white border border-slate-200 focus:border-emerald-500 rounded-lg px-2 py-1.5 text-xs outline-none"
 > <option value="before">Before (${'{'}10.00{'}'} )</option> <option value="after">After (10.00$)</option> </select> </div> </div> </div> <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-700 font-semibold"> Preview: {currencyPosition ==='before' ?`${customSymbol}99.00` :`99.00${customSymbol}`} &nbsp;·&nbsp; All prices on storefront, cart &amp; invoices update instantly after saving.
 </div> </div> <div className="pt-3 border-t border-slate-100"> <button
 onClick={handleSaveBrandingCMS}
 className="w-full sm:w-auto cursor-pointer flex items-center justify-center gap-1.5 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-sans font-semibold uppercase text-xs shadow-sm rounded-lg transition-colors"
 > <Save className="w-4 h-4" /> <span>Save Settings</span> </button> </div> </div> )}

 {/* SECTION: SMTP MAIL CONFIG */}
 {settingsSection ==='smtp' && (
 <div className="space-y-4">
   <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
     <button onClick={() => setSmtpSubTab('server')} className={`flex-1 cursor-pointer py-2 px-3 rounded-lg text-xs font-bold uppercase transition-all ${smtpSubTab === 'server' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>⚙️ Server Config</button>
     <button onClick={() => setSmtpSubTab('templates')} className={`flex-1 cursor-pointer py-2 px-3 rounded-lg text-xs font-bold uppercase transition-all ${smtpSubTab === 'templates' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>✉️ Email Templates</button>
   </div>

   {/* EMAIL TEMPLATES SUB-TAB */}
   {smtpSubTab === 'templates' && (
     <div className="space-y-6">
       <div>
         <h4 className="text-xs font-bold uppercase text-slate-400">Email Template Editor</h4>
         <p className="text-xs text-slate-400 font-semibold leading-relaxed mt-1">Customize the subject and HTML body of every automated email. Leave blank to use the built-in default. Use placeholders like <code className="bg-slate-100 px-1 rounded text-slate-600">{'{{customerName}}'}</code> — they are replaced automatically.</p>
       </div>

       <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
         <div className="flex items-center justify-between">
           <p className="text-[10px] font-extrabold uppercase text-emerald-700 tracking-wider">🛒 Order Confirmation — Customer</p>
           <div className="flex gap-2">
             <button onClick={() => setTemplatePreview(p => ({ ...p, orderConfirmation: !p.orderConfirmation }))} className="cursor-pointer text-[9px] font-bold uppercase bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded-lg transition-colors">{templatePreview.orderConfirmation ? 'Hide Preview' : 'Preview'}</button>
             <button onClick={() => { setOrderConfirmationSubject(''); setOrderConfirmationTemplate(''); }} className="cursor-pointer text-[9px] font-bold uppercase bg-rose-50 hover:bg-rose-100 text-rose-600 px-2 py-1 rounded-lg transition-colors">Reset Default</button>
           </div>
         </div>
         <p className="text-[9px] text-slate-400 font-medium">Sent to customer immediately after they place an order.</p>
         <div>
           <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Subject Line</label>
           <input type="text" value={orderConfirmationSubject} onChange={e => setOrderConfirmationSubject(e.target.value)} placeholder="e.g. Your order #{{orderNumber}} is confirmed! 🎉" className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" />
           <p className="text-[9px] text-slate-400 mt-0.5">Placeholders: <code className="bg-slate-100 px-1 rounded">{'{{storeName}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{orderNumber}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{customerName}}'}</code></p>
         </div>
         <div>
           <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">HTML Body</label>
           <textarea value={orderConfirmationTemplate} onChange={e => setOrderConfirmationTemplate(e.target.value)} rows={8} placeholder={'<!-- Leave blank for built-in default -->'} className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none transition-all resize-y" />
           <p className="text-[9px] text-slate-400 mt-0.5">Placeholders: <code className="bg-slate-100 px-1 rounded">{'{{customerName}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{orderNumber}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{items}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{subtotal}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{deliveryFee}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{total}}'}</code></p>
         </div>
         {templatePreview.orderConfirmation && orderConfirmationTemplate && (
           <div>
             <p className="text-[9px] font-bold uppercase text-slate-400 mb-1">Live Preview</p>
             <div className="border border-slate-200 rounded-lg overflow-hidden" style={{ maxHeight: 320, overflowY: 'auto' }}>
               <iframe srcDoc={orderConfirmationTemplate.replace('{{customerName}}','Mahfuj').replace('{{orderNumber}}','QF-91540').replace('{{items}}','<tr><td>Apple Juice</td><td>1</td><td>$2.30</td></tr>').replace('{{subtotal}}','16.60').replace('{{deliveryFee}}','5.00').replace('{{total}}','21.60')} style={{ width: '100%', height: 300, border: 'none' }} title="preview" />
             </div>
           </div>
         )}
       </div>

       <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
         <div className="flex items-center justify-between">
           <p className="text-[10px] font-extrabold uppercase text-blue-700 tracking-wider">🔔 New Order Alert — Admin</p>
           <div className="flex gap-2">
             <button onClick={() => setTemplatePreview(p => ({ ...p, adminOrder: !p.adminOrder }))} className="cursor-pointer text-[9px] font-bold uppercase bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded-lg transition-colors">{templatePreview.adminOrder ? 'Hide Preview' : 'Preview'}</button>
             <button onClick={() => { setAdminOrderNotificationSubject(''); setAdminOrderNotificationTemplate(''); }} className="cursor-pointer text-[9px] font-bold uppercase bg-rose-50 hover:bg-rose-100 text-rose-600 px-2 py-1 rounded-lg transition-colors">Reset Default</button>
           </div>
         </div>
         <p className="text-[9px] text-slate-400 font-medium">Sent to your admin email whenever a new order is placed.</p>
         <div>
           <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Subject Line</label>
           <input type="text" value={adminOrderNotificationSubject} onChange={e => setAdminOrderNotificationSubject(e.target.value)} placeholder="e.g. 🛍 New Order #{{orderNumber}} from {{customerName}}" className="w-full bg-slate-50 border border-slate-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" />
         </div>
         <div>
           <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">HTML Body</label>
           <textarea value={adminOrderNotificationTemplate} onChange={e => setAdminOrderNotificationTemplate(e.target.value)} rows={8} placeholder="<!-- Leave blank for built-in default -->" className="w-full bg-slate-50 border border-slate-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none transition-all resize-y" />
         </div>
         {templatePreview.adminOrder && adminOrderNotificationTemplate && (
           <div className="border border-slate-200 rounded-lg overflow-hidden" style={{ maxHeight: 320, overflowY: 'auto' }}>
             <iframe srcDoc={adminOrderNotificationTemplate} style={{ width: '100%', height: 300, border: 'none' }} title="admin-preview" />
           </div>
         )}
       </div>

       <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
         <div className="flex items-center justify-between">
           <p className="text-[10px] font-extrabold uppercase text-violet-700 tracking-wider">📦 Order Status Update — Customer</p>
           <div className="flex gap-2">
             <button onClick={() => setTemplatePreview(p => ({ ...p, orderStatus: !p.orderStatus }))} className="cursor-pointer text-[9px] font-bold uppercase bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded-lg transition-colors">{templatePreview.orderStatus ? 'Hide Preview' : 'Preview'}</button>
             <button onClick={() => { setOrderStatusSubject(''); setOrderStatusTemplate(''); }} className="cursor-pointer text-[9px] font-bold uppercase bg-rose-50 hover:bg-rose-100 text-rose-600 px-2 py-1 rounded-lg transition-colors">Reset Default</button>
           </div>
         </div>
         <p className="text-[9px] text-slate-400 font-medium">Sent to customer when you change an order status from the Orders tab.</p>
         <div>
           <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Subject Line</label>
           <input type="text" value={orderStatusSubject} onChange={e => setOrderStatusSubject(e.target.value)} placeholder="e.g. Your order #{{orderNumber}} is now {{status}} {{emoji}}" className="w-full bg-slate-50 border border-slate-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-400 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" />
           <p className="text-[9px] text-slate-400 mt-0.5">Placeholders: <code className="bg-slate-100 px-1 rounded">{'{{orderNumber}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{status}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{emoji}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{customerName}}'}</code></p>
         </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">HTML Body</label>
            <textarea value={orderStatusTemplate} onChange={e => setOrderStatusTemplate(e.target.value)} rows={8} placeholder="<!-- Leave blank for built-in default -->" className="w-full bg-slate-50 border border-slate-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-400 rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none transition-all resize-y" />
          </div>
          {templatePreview.orderStatus && orderStatusTemplate && (
            <div>
              <p className="text-[9px] font-bold uppercase text-slate-400 mb-1">Live Preview</p>
              <div className="border border-slate-200 rounded-lg overflow-hidden" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <iframe
                  srcDoc={orderStatusTemplate
                    .replace(/\{\{customerName\}\}/g, 'Mahfuj')
                    .replace(/\{\{orderNumber\}\}/g, 'QF-91540')
                    .replace(/\{\{status\}\}/g, 'Shipped')
                    .replace(/\{\{emoji\}\}/g, '🚚')
                    .replace(/\{\{storeName\}\}/g, siteSettings?.websiteName || 'E-Shop')}
                  style={{ width: '100%', height: 300, border: 'none' }}
                  title="status-preview"
                />
              </div>
            </div>
          )}
        </div>

       <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
         <div className="flex items-center justify-between">
           <p className="text-[10px] font-extrabold uppercase text-amber-700 tracking-wider">👋 Welcome Email — New Signup</p>
           <div className="flex gap-2">
             <button onClick={() => setTemplatePreview(p => ({ ...p, welcome: !p.welcome }))} className="cursor-pointer text-[9px] font-bold uppercase bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded-lg transition-colors">{templatePreview.welcome ? 'Hide Preview' : 'Preview'}</button>
             <button onClick={() => { setWelcomeSubject(''); setWelcomeTemplate(''); }} className="cursor-pointer text-[9px] font-bold uppercase bg-rose-50 hover:bg-rose-100 text-rose-600 px-2 py-1 rounded-lg transition-colors">Reset Default</button>
           </div>
         </div>
         <p className="text-[9px] text-slate-400 font-medium">Sent to a new user right after they create an account.</p>
         <div>
           <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Subject Line</label>
           <input type="text" value={welcomeSubject} onChange={e => setWelcomeSubject(e.target.value)} placeholder="e.g. Welcome to {{storeName}}, {{name}}! 🎉" className="w-full bg-slate-50 border border-slate-200 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" />
           <p className="text-[9px] text-slate-400 mt-0.5">Placeholders: <code className="bg-slate-100 px-1 rounded">{'{{name}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{storeName}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{email}}'}</code></p>
         </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">HTML Body</label>
            <textarea value={welcomeTemplate} onChange={e => setWelcomeTemplate(e.target.value)} rows={8} placeholder="<!-- Leave blank for built-in default -->" className="w-full bg-slate-50 border border-slate-200 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none transition-all resize-y" />
          </div>
          {templatePreview.welcome && welcomeTemplate && (
            <div>
              <p className="text-[9px] font-bold uppercase text-slate-400 mb-1">Live Preview</p>
              <div className="border border-slate-200 rounded-lg overflow-hidden" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <iframe
                  srcDoc={welcomeTemplate
                    .replace(/\{\{name\}\}/g, 'Mahfuj')
                    .replace(/\{\{customerName\}\}/g, 'Mahfuj')
                    .replace(/\{\{storeName\}\}/g, siteSettings?.websiteName || 'E-Shop')
                    .replace(/\{\{email\}\}/g, 'customer@example.com')}
                  style={{ width: '100%', height: 300, border: 'none' }}
                  title="welcome-preview"
                />
              </div>
            </div>
          )}
        </div>

       <div className="pt-3 border-t border-slate-100">
         <button onClick={handleSaveSMTPCMS} className="w-full sm:w-auto cursor-pointer flex items-center justify-center gap-1.5 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-sans font-semibold uppercase text-xs shadow-sm rounded-lg transition-colors">
           <Save className="w-4 h-4" /> <span>Save Email Templates</span>
         </button>
       </div>
     </div>
   )}

   {smtpSubTab === 'server' && (
 <div className="space-y-5"> <div> <h4 className="text-xs font-bold uppercase text-slate-400"> SMTP CLIENT EMAIL SERVER</h4> <p className="text-xs text-slate-400 font-semibold leading-relaxed mt-1">Configure your outgoing mail server. Used for order receipts, OTP password resets, and newsletter emails. When disabled, emails are skipped (simulated in console).</p> </div> {/* ── Enable toggle ── */}
 <div className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200"> <input type="checkbox" id="smtp-en" checked={smtpEnabled} onChange={(e) => setSmtpEnabled(e.target.checked)} className="scale-110 accent-emerald-600 rounded cursor-pointer" /> <label htmlFor="smtp-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700">Enable SMTP active client delivery</label> </div> {/* ── Server credentials ── */}
 <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"> <p className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider"> Server Credentials</p> <div className="grid grid-cols-1 md:grid-cols-2 gap-3"> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Mail Host</label> <input type="text" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com"
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" /> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Port (TLS/SSL)</label> <input type="text" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587 (TLS) or 465 (SSL)"
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" /> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Sender Email Address</label> <input type="email" value={smtpEmailVal} onChange={(e) => setSmtpEmailVal(e.target.value)} placeholder="sender@gmail.com"
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" /> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">App Password / Secret</label> <input type="password" value={smtpPassVal} onChange={(e) => setSmtpPassVal(e.target.value)} placeholder="••••••••••••••••"
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" /> </div> <div className="md:col-span-2"> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Sender Display Name <span className="normal-case font-normal text-slate-400">(shown in inbox"From" field)</span></label> <input type="text" value={smtpFromName} onChange={(e) => setSmtpFromName(e.target.value)} placeholder="e.g. My Shop Support"
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" /> </div> </div> <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-[10px] text-amber-800 font-medium"> <strong>Gmail users:</strong> Use an <strong>App Password</strong>, not your Gmail login password. Go to Google Account → Security → 2-Step Verification → App Passwords. Port 587 (TLS) recommended.
 </div> </div> {/* ── OTP Configuration ── */}
 <div className="bg-indigo-50/40 border border-indigo-200 rounded-xl p-4 space-y-3"> <div className="flex items-center justify-between"> <p className="text-[10px] font-extrabold uppercase text-indigo-700 tracking-wider"> OTP Password Reset Configuration</p> <div className="flex items-center gap-2"> <input type="checkbox" id="otp-en" checked={otpEnabled} onChange={(e) => setOtpEnabled(e.target.checked)} className="scale-110 accent-indigo-600 rounded cursor-pointer" /> <label htmlFor="otp-en" className="text-[10px] font-bold uppercase cursor-pointer text-indigo-700">Enable OTP Reset</label> </div> </div> <p className="text-[9px] text-slate-500 font-medium">When enabled, users who click"Forgot Password" must verify a 6-digit OTP sent to their registered email before resetting their password.</p> <div className="grid grid-cols-1 md:grid-cols-2 gap-3"> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">OTP Expiry <span className="normal-case font-normal">(minutes)</span></label> <input type="number" min={1} max={60} value={otpExpiryMinutes} onChange={(e) => setOtpExpiryMinutes(Number(e.target.value))}
 className="w-full bg-white border border-slate-200 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" /> <p className="text-[9px] text-slate-400 mt-0.5">Default: 10 minutes. Range: 1–60.</p> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Custom Email Subject <span className="normal-case font-normal text-slate-400">(optional)</span></label> <input type="text" value={otpSubject} onChange={(e) => setOtpSubject(e.target.value)} placeholder="e.g. Your OTP Code — My Store"
 className="w-full bg-white border border-slate-200 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" /> <p className="text-[9px] text-slate-400 mt-0.5">Leave blank to use default:"[Store] Your OTP Code"</p> </div> </div> {/* ── Test OTP delivery ── */}
 <div className="bg-white border border-indigo-100 rounded-lg p-3 space-y-2"> <p className="text-[10px] font-extrabold uppercase text-slate-500"> Send Test OTP Email</p> <p className="text-[9px] text-slate-400 font-medium">Send a real OTP email to verify your SMTP settings are working before going live. Save credentials first.</p> <div className="flex gap-2"> <input
 type="email"
 value={otpTestEmail}
 onChange={(e) => setOtpTestEmail(e.target.value)}
 placeholder="test@example.com"
 className="flex-1 bg-slate-50 border border-slate-200 focus:border-indigo-400 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> <button
 onClick={handleSendTestOtp}
 disabled={otpTestStatus?.type ==='loading'}
 className="cursor-pointer px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold text-xs rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5"
 > {otpTestStatus?.type ==='loading'
 ? <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Sending…</> : <> Send Test</>}
 </button> </div> {otpTestStatus && otpTestStatus.type !=='loading' && (
 <div className={`rounded-lg px-3 py-2 text-[10px] font-semibold ${otpTestStatus.type ==='success' ?'bg-emerald-50 border border-emerald-200 text-emerald-800' :'bg-rose-50 border border-rose-200 text-rose-800'}`}> {otpTestStatus.msg}
 </div> )}
 </div> </div> <div className="pt-3 border-t border-slate-100"> <button
 onClick={handleSaveSMTPCMS}
 className="w-full sm:w-auto cursor-pointer flex items-center justify-center gap-1.5 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-sans font-semibold uppercase text-xs shadow-sm rounded-lg transition-colors"
 > <Save className="w-4 h-4" /> <span>Save SMTP & OTP Settings</span> </button> </div> </div>
   )}
 </div>
 )}


 {/* SECTION: SMS & EMAIL VERIFICATION */}
 {settingsSection ==='sms' && (
 <div className="space-y-6"> <div> <h4 className="text-xs font-bold uppercase text-slate-400"> SMS GATEWAY — TWILIO</h4> <p className="text-xs text-slate-400 font-semibold leading-relaxed mt-1">Configure Twilio to send OTP codes via SMS for password resets and order notifications.</p> </div> {/* Enable SMS */}
 <div className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200"> <input type="checkbox" id="sms-en" checked={smsEnabled} onChange={e => setSmsEnabled(e.target.checked)} className="scale-110 accent-emerald-600 rounded cursor-pointer" /> <label htmlFor="sms-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700">Enable SMS Gateway (Twilio)</label> </div> {/* Twilio Credentials */}
 <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"> <p className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider"> Twilio Credentials</p>
 {/* Decoy fields to absorb browser/password-manager autofill so admin login creds don't leak into Twilio inputs */}
 <div style={{ position: 'absolute', left: '-9999px', height: 0, width: 0, overflow: 'hidden' }} aria-hidden="true">
   <input type="text" name="username" tabIndex={-1} autoComplete="username" defaultValue="" readOnly />
   <input type="password" name="password" tabIndex={-1} autoComplete="current-password" defaultValue="" readOnly />
 </div>
 <form autoComplete="off" onSubmit={e => e.preventDefault()}>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3"> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Account SID</label> <input type="text" value={smsAccountSid} onChange={e => setSmsAccountSid(e.target.value)} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
 name="twilio_account_sid" autoComplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other"
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" /> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Auth Token</label> <input type="password" value={smsAuthToken} onChange={e => setSmsAuthToken(e.target.value)} placeholder="••••••••••••••••••••••••••••••••"
 name="twilio_auth_token" autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" data-form-type="other"
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" /> </div> <div className="md:col-span-2"> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">From Number <span className="normal-case font-normal text-slate-400">(e.g. +15550001234)</span></label> <input type="text" value={smsFromNumber} onChange={e => setSmsFromNumber(e.target.value)} placeholder="+15550001234"
 name="twilio_from_number" autoComplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other"
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" /> </div> </div>
 </form>
 </div> {/* SMS OTP Config */}
 <div className="bg-violet-50/40 border border-violet-200 rounded-xl p-4 space-y-3"> <div className="flex items-center justify-between"> <p className="text-[10px] font-extrabold uppercase text-violet-700 tracking-wider"> SMS OTP Configuration</p> <div className="flex items-center gap-2"> <input type="checkbox" id="sms-otp-en" checked={smsOtpEnabled} onChange={e => setSmsOtpEnabled(e.target.checked)} className="scale-110 accent-violet-600 rounded cursor-pointer" /> <label htmlFor="sms-otp-en" className="text-[10px] font-bold uppercase cursor-pointer text-violet-700">Enable SMS OTP</label> </div> </div> <div className="grid grid-cols-1 md:grid-cols-2 gap-3"> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">OTP Expiry (minutes)</label> <input type="number" min={1} max={60} value={smsOtpExpiry} onChange={e => setSmsOtpExpiry(Number(e.target.value))}
 className="w-full bg-white border border-slate-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-400 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" /> </div> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Message Template</label> <textarea value={smsMsgTemplate} onChange={e => setSmsMsgTemplate(e.target.value)} rows={2}
 className="w-full bg-white border border-slate-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-400 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all resize-none"
 placeholder="{{code}} is your {{store}} verification code. Valid for {{expiry}} min." /> <p className="text-[9px] text-slate-400 mt-1">Placeholders: <code className="bg-slate-100 px-1 rounded">{'{{code}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{store}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{expiry}}'}</code></p> </div> {/* Live preview */}
 <div className="bg-white border border-violet-100 rounded-lg p-3"> <p className="text-[9px] font-extrabold uppercase text-slate-400 mb-1"> Live Preview</p> <p className="text-xs text-slate-700 font-mono bg-slate-50 rounded px-2 py-1.5"> {smsMsgTemplate.replace('{{code}}','847291').replace('{{store}}', siteSettings?.websiteName ||'E-Shop').replace('{{expiry}}', String(smsOtpExpiry))}
 </p> </div> {/* Test SMS */}
 <div className="bg-white border border-violet-100 rounded-lg p-3 space-y-2"> <p className="text-[10px] font-extrabold uppercase text-slate-500"> Send Test SMS</p> <div className="flex gap-2"> <input type="tel" value={smsTestPhone} onChange={e => setSmsTestPhone(e.target.value)} placeholder="+880 17XX XXX XXX"
 className="flex-1 bg-slate-50 border border-slate-200 focus:border-violet-400 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" /> <button onClick={handleSendTestSms} disabled={smsTestStatus?.type ==='loading'}
 className="cursor-pointer px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-bold text-xs rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5"> {smsTestStatus?.type ==='loading' ? <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Sending…</> : <> Send Test</>}
 </button> </div> {smsTestStatus && smsTestStatus.type !=='loading' && (
 <div className={`rounded-lg px-3 py-2 text-[10px] font-semibold ${smsTestStatus.type ==='success' ?'bg-emerald-50 border border-emerald-200 text-emerald-800' :'bg-rose-50 border border-rose-200 text-rose-800'}`}> {smsTestStatus.msg}
 </div> )}
 </div> </div> {/* WhatsApp Business API */}
 <div className="bg-green-50/40 border border-green-200 rounded-xl p-4 space-y-3"> <div className="flex items-center justify-between"> <p className="text-[10px] font-extrabold uppercase text-green-700 tracking-wider"> WhatsApp Business API</p> <div className="flex items-center gap-2"> <input type="checkbox" id="wa-en" checked={waEnabled} onChange={e => setWaEnabled(e.target.checked)} className="scale-110 accent-green-600 rounded cursor-pointer" /> <label htmlFor="wa-en" className="text-[10px] font-bold uppercase cursor-pointer text-green-700">Enable WhatsApp</label> </div> </div> <div className="grid grid-cols-1 md:grid-cols-2 gap-3"> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Phone Number ID</label> <input type="text" value={waPhoneNumberId} onChange={e => setWaPhoneNumberId(e.target.value)} placeholder="1234567890"
 className="w-full bg-white border border-slate-200 focus:border-green-400 focus:ring-1 focus:ring-green-400 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" /> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Access Token</label> <input type="password" value={waAccessToken} onChange={e => setWaAccessToken(e.target.value)} placeholder="EAAxxxxxxxx"
 className="w-full bg-white border border-slate-200 focus:border-green-400 focus:ring-1 focus:ring-green-400 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" /> </div> <div className="md:col-span-2"> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Message Template Name</label> <input type="text" value={waTemplateName} onChange={e => setWaTemplateName(e.target.value)} placeholder="order_status_update"
 className="w-full bg-white border border-slate-200 focus:border-green-400 focus:ring-1 focus:ring-green-400 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" /> <p className="text-[9px] text-slate-400 mt-0.5">Template must be approved in your Meta Business account.</p> </div> </div> </div> {/* Email Verification */}
 <div className="bg-amber-50/40 border border-amber-200 rounded-xl p-4 space-y-3"> <p className="text-[10px] font-extrabold uppercase text-amber-700 tracking-wider"> Email Verification</p> <div className="flex items-center gap-2 bg-white p-2.5 rounded-lg border border-amber-100"> <input type="checkbox" id="ev-en" checked={evEnabled} onChange={e => setEvEnabled(e.target.checked)} className="scale-110 accent-amber-600 rounded cursor-pointer" /> <label htmlFor="ev-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700">Require Email Verification on Signup</label> </div> <div className="flex items-center gap-2 bg-white p-2.5 rounded-lg border border-amber-100"> <input type="checkbox" id="ev-order" checked={evRequireBeforeOrder} onChange={e => setEvRequireBeforeOrder(e.target.checked)} className="scale-110 accent-amber-600 rounded cursor-pointer" /> <label htmlFor="ev-order" className="text-xs font-bold uppercase cursor-pointer text-slate-700">Block Checkout Until Verified</label> </div> <div className="flex items-center gap-2 bg-white p-2.5 rounded-lg border border-blue-100"> <input type="checkbox" id="ev-otp-signin" checked={evOtpSignIn} onChange={e => setEvOtpSignIn(e.target.checked)} className="scale-110 accent-blue-600 rounded cursor-pointer" /> <label htmlFor="ev-otp-signin" className="text-xs font-bold uppercase cursor-pointer text-slate-700">Require OTP Verification on Sign-In</label> </div> <p className="text-[9px] text-slate-500 ml-7 -mt-2">🔐 Users must verify their sign-in via a 6-digit OTP code sent to their email.</p> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Verification Token Expiry (hours)</label> <input type="number" min={1} max={168} value={evTokenExpiry} onChange={e => setEvTokenExpiry(Number(e.target.value))}
 className="w-full bg-white border border-slate-200 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all" /> <p className="text-[9px] text-slate-400 mt-0.5">Default: 24 hours. Max: 168 (1 week).</p> </div> </div> <div className="pt-3 border-t border-slate-100"> <button onClick={handleSaveSMSCMS}
 className="w-full sm:w-auto cursor-pointer flex items-center justify-center gap-1.5 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-sans font-semibold uppercase text-xs shadow-sm rounded-lg transition-colors"> <Save className="w-4 h-4" /> <span>Save SMS & Verification Settings</span> </button> </div> </div> )}

 {/* SECTION: PAYMENTS METHOD SETUP */}
 {settingsSection ==='payment' && (
 <div className="space-y-6"> <div> <h4 className="text-xs font-bold uppercase text-slate-400"> PAYMENT CHANNELS SETUP</h4> <p className="text-xs text-slate-500 font-medium">Control dynamic configurations for offline manual transfers (bKash/Nagad/Rocket/Bank) and automatic gateways (Stripe/SSLCommerz/Razorpay).</p> </div> {/* 1. MANUAL CHANNELS SECTION */}
 <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-4"> <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b pb-1.5 border-slate-200">1. Manual Mobile & Bank Payment Options</h5> <div className="grid grid-cols-1 md:grid-cols-3 gap-3"> <div className="bg-white p-3 rounded-lg border border-slate-200 flex items-center gap-3"> <input
 type="checkbox"
 id="pay-cod-en"
 checked={payCod}
 onChange={(e) => setPayCod(e.target.checked)}
 className="scale-110 accent-emerald-600 rounded cursor-pointer"
 /> <div> <label htmlFor="pay-cod-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700 block">COD Option</label> <span className="text-[9px] text-slate-500 block font-semibold text-slate-500">Cash On Delivery</span> </div> </div> <div className="bg-white p-3 rounded-lg border border-slate-200 flex items-center gap-3"> <input
 type="checkbox"
 id="pay-bkash-en"
 checked={payBkash}
 onChange={(e) => setPayBkash(e.target.checked)}
 className="scale-110 accent-pink-600 rounded cursor-pointer"
 /> <div> <label htmlFor="pay-bkash-en" className="text-xs font-bold uppercase cursor-pointer text-pink-600 block">bKash Option</label> <span className="text-[9px] block font-semibold text-slate-500">bKash mobile wallet</span> </div> </div> <div className="bg-white p-3 rounded-lg border border-slate-200 flex items-center gap-3"> <input
 type="checkbox"
 id="pay-nagad-en"
 checked={payNagad}
 onChange={(e) => setPayNagad(e.target.checked)}
 className="scale-110 accent-orange-600 rounded cursor-pointer"
 /> <div> <label htmlFor="pay-nagad-en" className="text-xs font-bold uppercase cursor-pointer text-orange-60 block">Nagad Option</label> <span className="text-[9px] block font-semibold text-slate-500">Nagad mobile wallet</span> </div> </div> <div className="bg-white p-3 rounded-lg border border-slate-200 flex items-center gap-3"> <input
 type="checkbox"
 id="pay-rocket-en"
 checked={payRocket}
 onChange={(e) => setPayRocket(e.target.checked)}
 className="scale-110 accent-purple-600 rounded cursor-pointer"
 /> <div> <label htmlFor="pay-rocket-en" className="text-xs font-bold uppercase cursor-pointer text-purple-750 block">Rocket Option</label> <span className="text-[9px] block font-semibold text-slate-500">Rocket mobile wallet</span> </div> </div> <div className="bg-white p-3 rounded-lg border border-slate-200 flex items-center gap-3"> <input
 type="checkbox"
 id="pay-bank-en"
 checked={payBank}
 onChange={(e) => setPayBank(e.target.checked)}
 className="scale-110 accent-blue-600 rounded cursor-pointer"
 /> <div> <label htmlFor="pay-bank-en" className="text-xs font-bold uppercase cursor-pointer text-blue-700 block">Bank Transfer</label> <span className="text-[9px] block font-semibold text-slate-500">Direct bank details</span> </div> </div> <div className="bg-white p-3 rounded-lg border border-slate-200 flex items-center gap-3"> <input
 type="checkbox"
 id="pay-credit-manual-en"
 checked={payCreditManual}
 onChange={(e) => setPayCreditManual(e.target.checked)}
 className="scale-110 accent-emerald-600 rounded cursor-pointer"
 /> <div> <label htmlFor="pay-credit-manual-en" className="text-xs font-bold uppercase cursor-pointer text-emerald-800 block">Manual Cards</label> <span className="text-[9px] block font-semibold text-slate-500">Offline credit reference</span> </div> </div> </div> {/* Manual inputs fields expansion */}
 {payBkash && (
 <div className="bg-pink-50/20 border border-dashed border-pink-200 rounded-xl p-3.5 space-y-3"> <div className="text-[10px] font-bold text-pink-600 uppercase">bKash Merchant Target Setup</div> <div className="grid grid-cols-1 md:grid-cols-3 gap-3"> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">bKash Active Number</label> <input type="text" value={payBkashNo} onChange={(e) => setPayBkashNo(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">bKash Logo/Emoji</label> <input type="text" value={payBkashLogoEmoji} onChange={(e) => setPayBkashLogoEmoji(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">QR Code URL Link</label> <input type="text" value={payBkashQrCodeUrl} onChange={(e) => setPayBkashQrCodeUrl(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Instructions for customer</label> <input type="text" value={payBkashGuide} onChange={(e) => setPayBkashGuide(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> </div> )}

 {payNagad && (
 <div className="bg-orange-50/20 border border-dashed border-orange-200 rounded-xl p-3.5 space-y-3"> <div className="text-[10px] font-bold text-orange-600 uppercase">Nagad Wallet Target Setup</div> <div className="grid grid-cols-1 md:grid-cols-3 gap-3"> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">Nagad Active Number</label> <input type="text" value={payNagadNo} onChange={(e) => setPayNagadNo(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">Nagad Logo/Emoji</label> <input type="text" value={payNagadLogoEmoji} onChange={(e) => setPayNagadLogoEmoji(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">QR Code URL Link</label> <input type="text" value={payNagadQrCodeUrl} onChange={(e) => setPayNagadQrCodeUrl(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Instructions</label> <input type="text" value={payNagadGuide} onChange={(e) => setPayNagadGuide(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> </div> )}

 {payRocket && (
 <div className="bg-purple-50/20 border border-dashed border-purple-200 rounded-xl p-3.5 space-y-3"> <div className="text-[10px] font-bold text-purple-700 uppercase font-sans">Rocket Target Setup</div> <div className="grid grid-cols-1 md:grid-cols-3 gap-3"> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">Rocket Active Number</label> <input type="text" value={payRocketNo} onChange={(e) => setPayRocketNo(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">Rocket Logo/Emoji</label> <input type="text" value={payRocketLogoEmoji} onChange={(e) => setPayRocketLogoEmoji(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">QR Code URL Link</label> <input type="text" value={payRocketQrCodeUrl} onChange={(e) => setPayRocketQrCodeUrl(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Instructions</label> <input type="text" value={payRocketGuide} onChange={(e) => setPayRocketGuide(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> </div> )}

 {payBank && (
 <div className="bg-blue-50/25 border border-dashed border-blue-200 rounded-xl p-3.5 space-y-3"> <div className="text-[10px] font-bold text-blue-700 uppercase font-sans">Direct Bank account Setup</div> <div className="grid grid-cols-1 md:grid-cols-3 gap-3"> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">Bank Name</label> <input type="text" value={payBankName} onChange={(e) => setPayBankName(e.target.value)} placeholder="e.g. Dhaka Bank Ltd" className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">Account Number</label> <input type="text" value={payBankNo} onChange={(e) => setPayBankNo(e.target.value)} placeholder="102-xxxxx" className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">Account Holder Title</label> <input type="text" value={payBankHolder} onChange={(e) => setPayBankHolder(e.target.value)} placeholder="e.g. Quirky Fruity Ltd" className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> </div> <div className="grid grid-cols-1 md:grid-cols-2 gap-3"> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">Bank Symbol Logo Emoji</label> <input type="text" value={payBankLogoEmoji} onChange={(e) => setPayBankLogoEmoji(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">QR Code Url Link</label> <input type="text" value={payBankQrCodeUrl} onChange={(e) => setPayBankQrCodeUrl(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Wire instructions for users</label> <input type="text" value={payBankGuide} onChange={(e) => setPayBankGuide(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> </div> )}

 {payCreditManual && (
 <div className="bg-emerald-50/20 border border-dashed border-emerald-200 rounded-xl p-3.5 space-y-3"> <div className="text-[10px] font-bold text-emerald-700 uppercase">Offline Cards Deposit Target Setup</div> <div className="grid grid-cols-1 md:grid-cols-3 gap-3"> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">Manual Reference No.</label> <input type="text" value={payCreditManualNo} onChange={(e) => setPayCreditManualNo(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">Logo Emoji Icon</label> <input type="text" value={payCreditManualLogoEmoji} onChange={(e) => setPayCreditManualLogoEmoji(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase">Instruction Sheet Image Url</label> <input type="text" value={payCreditManualQrCodeUrl} onChange={(e) => setPayCreditManualQrCodeUrl(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Credit manual payment instructions</label> <input type="text" value={payCreditManualGuide} onChange={(e) => setPayCreditManualGuide(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800" /> </div> </div> )}
 </div> {/* 2. AUTOMATIC PAYMENT GATEWAYS SECTION */}
 <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-5"> <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b pb-1.5 border-slate-200">2. Automatic Core Payment Gateways</h5> {/* GATEWAY 0: PAYPAL */}
 <div className="space-y-3.5 border-b pb-4 border-slate-200"> <div className="flex items-center justify-between"> <div className="flex items-center gap-2"> <input
 type="checkbox"
 id="pay-paypal-en"
 checked={payPaypal}
 onChange={(e) => setPayPaypal(e.target.checked)}
 className="scale-110 accent-blue-500 rounded cursor-pointer"
 /> <label htmlFor="pay-paypal-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700">PayPal Express Gateway</label> </div> {payPaypal && (
 <div className="flex items-center gap-1.5 bg-white border px-2 py-1 rounded-lg"> <span className="text-[9px] font-extrabold text-slate-500 uppercase">Sandbox Mode:</span> <input
 type="checkbox"
 checked={payPaypalSandbox}
 onChange={(e) => setPayPaypalSandbox(e.target.checked)}
 className="accent-slate-900 cursor-pointer"
 /> </div> )}
 </div> {payPaypal && (
 <div className="animate-fade-in"> <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">PayPal Client ID</label> <input
 type="text"
 required
 placeholder={payPaypalSandbox ?"sb-xxxx... (Sandbox Client ID)" :"AxxXX... (Live Client ID)"}
 value={payPaypalClientId}
 onChange={(e) => setPayPaypalClientId(e.target.value)}
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800"
 /> <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5 mt-2.5">PayPal Client Secret</label> <input
 type="password"
 required
 placeholder={payPaypalSandbox ?"Sandbox Client Secret" :"Live Client Secret"}
 value={payPaypalClientSecret}
 onChange={(e) => setPayPaypalClientSecret(e.target.value)}
 autoComplete="new-password"
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800"
 /> <p className="text-[9px] text-slate-400 mt-1">Get your Client ID and Secret from <span className="font-semibold">developer.paypal.com → My Apps &amp; Credentials</span></p> <GwTestBtn gw="paypal" onClick={() => handleTestGateway('paypal', { clientId: payPaypalClientId, clientSecret: payPaypalClientSecret, sandbox: String(payPaypalSandbox) })} disabled={!payPaypalClientId || !payPaypalClientSecret} /> </div> )}
 </div> {/* GATEWAY 1: STRIPE */}
 <div className="space-y-3.5 border-b pb-4 border-slate-200"> <div className="flex items-center justify-between"> <div className="flex items-center gap-2"> <input
 type="checkbox"
 id="pay-stripe-en"
 checked={payStripe}
 onChange={(e) => setPayStripe(e.target.checked)}
 className="scale-110 accent-blue-600 rounded cursor-pointer"
 /> <label htmlFor="pay-stripe-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700">Stripe Payment Gateway</label> </div> {payStripe && (
 <div className="flex items-center gap-1.5 bg-white border px-2 py-1 rounded-lg"> <span className="text-[9px] font-extrabold text-slate-500 uppercase">Sandbox Mode:</span> <input
 type="checkbox"
 checked={payStripeSandbox}
 onChange={(e) => setPayStripeSandbox(e.target.checked)}
 className="accent-slate-900 cursor-pointer"
 /> </div> )}
 </div> {payStripe && (
 <>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 animate-fade-in"> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Stripe Publishable API Key</label> <input
 type="text"
 required
 placeholder="pk_test_..."
 value={payStripeKey}
 onChange={(e) => setPayStripeKey(e.target.value)}
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800"
 /> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Stripe Secret Encryption Key</label> <input
 type="password"
 required
 placeholder="sk_test_..."
 value={payStripeSecret}
 onChange={(e) => setPayStripeSecret(e.target.value)}
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800"
 /> </div> </div> <GwTestBtn gw="stripe" onClick={() => handleTestGateway('stripe', { secretKey: payStripeSecret })} disabled={!payStripeSecret} />
 </>
 )}
 </div> {/* GATEWAY 2: SSLCOMMERZ */}
 <div className="space-y-3.5 border-b pb-4 border-slate-200"> <div className="flex items-center justify-between"> <div className="flex items-center gap-2"> <input
 type="checkbox"
 id="pay-ssl-en"
 checked={paySsl}
 onChange={(e) => setPaySsl(e.target.checked)}
 className="scale-110 accent-emerald-600 rounded cursor-pointer"
 /> <label htmlFor="pay-ssl-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700">SSLCommerz Digital Gateway</label> </div> {paySsl && (
 <div className="flex items-center gap-1.5 bg-white border px-2 py-1 rounded-lg"> <span className="text-[9px] font-extrabold text-slate-500 uppercase">Sandbox Mode:</span> <input
 type="checkbox"
 checked={paySslSandbox}
 onChange={(e) => setPaySslSandbox(e.target.checked)}
 className="accent-slate-900 cursor-pointer"
 /> </div> )}
 </div> {paySsl && (
 <>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 animate-fade-in"> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">SSLCommerz Store ID</label> <input
 type="text"
 required
 placeholder="e.g. store_xxxx"
 value={paySslStoreId}
 onChange={(e) => setPaySslStoreId(e.target.value)}
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800"
 /> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">SSLCommerz Store Password</label> <input
 type="password"
 required
 placeholder="e.g. password_xxxx"
 value={paySslStorePass}
 onChange={(e) => setPaySslStorePass(e.target.value)}
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800"
 /> </div> </div> <GwTestBtn gw="sslcommerz" onClick={() => handleTestGateway('sslcommerz', { storeId: paySslStoreId, storePass: paySslStorePass, sandbox: String(paySslSandbox) })} disabled={!paySslStoreId || !paySslStorePass} />
 </>
 )}
 </div> {/* GATEWAY 3: RAZORPAY */}
 <div className="space-y-3.5 pb-2"> <div className="flex items-center justify-between"> <div className="flex items-center gap-2"> <input
 type="checkbox"
 id="pay-razor-en"
 checked={payRazor}
 onChange={(e) => setPayRazor(e.target.checked)}
 className="scale-110 accent-blue-600 rounded cursor-pointer"
 /> <label htmlFor="pay-razor-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700">Razorpay Digital Gateway</label> </div> {payRazor && (
 <div className="flex items-center gap-1.5 bg-white border px-2 py-1 rounded-lg"> <span className="text-[9px] font-extrabold text-slate-500 uppercase">Sandbox Mode:</span> <input
 type="checkbox"
 checked={payRazorSandbox}
 onChange={(e) => setPayRazorSandbox(e.target.checked)}
 className="accent-slate-900 cursor-pointer"
 /> </div> )}
 </div> {payRazor && (
 <>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 animate-fade-in"> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Razorpay Key ID</label> <input
 type="text"
 required
 placeholder="rzp_test_..."
 value={payRazorKeyId}
 onChange={(e) => setPayRazorKeyId(e.target.value)}
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800"
 /> </div> <div> <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Razorpay Key Secret</label> <input
 type="password"
 required
 placeholder="e.g. key_secret_xxxxx"
 value={payRazorKeySecret}
 onChange={(e) => setPayRazorKeySecret(e.target.value)}
 className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800"
 /> </div> </div> <GwTestBtn gw="razorpay" onClick={() => handleTestGateway('razorpay', { keyId: payRazorKeyId, keySecret: payRazorKeySecret })} disabled={!payRazorKeyId || !payRazorKeySecret} />
 </>
 )}
 </div> {/* GATEWAY 4: AUTOMATIC BKASH PORTAL */}
 <div className="space-y-3.5 border-t pt-4 border-slate-200"> <div className="flex items-center justify-between"> <div className="flex items-center gap-2"> <input
 type="checkbox"
 id="pay-bkash-auto-en"
 checked={payBkashAuto}
 onChange={(e) => setPayBkashAuto(e.target.checked)}
 className="scale-110 accent-pink-600 rounded cursor-pointer"
 /> <label htmlFor="pay-bkash-auto-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700 flex items-center gap-1.5"> <span className="text-pink-600 text-sm">৳</span> bKash Automatic API Gateway
 </label> </div> <span className="text-[8px] bg-pink-50 border border-pink-200 text-pink-700 rounded px-1.5 py-0.5 font-bold uppercase">Dynamic Checkout</span> </div> {payBkashAuto && (
 <div className="space-y-2.5 bg-pink-50 border border-pink-200 rounded-xl p-3.5"> <p className="text-[10px] text-pink-700 font-semibold"> Enter your bKash Merchant API credentials from the <a href="https://developer.bka.sh" target="_blank" className="underline">bKash Developer Portal</a>.
 </p> <div className="flex items-center gap-2 mb-1"> <input type="checkbox" id="bkash-sandbox" checked={payBkashSandbox} onChange={e => setPayBkashSandbox(e.target.checked)} className="accent-pink-600 cursor-pointer" /> <label htmlFor="bkash-sandbox" className="text-[10px] font-bold uppercase text-pink-700 cursor-pointer">Sandbox / Test Mode</label> </div> <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"> <div> <label className="block text-[9px] font-bold uppercase text-slate-500 mb-1">App Key</label> <input type="text" value={payBkashAppKey} onChange={e => setPayBkashAppKey(e.target.value)} placeholder="e.g. 4f6o05aar7xxxxxx" className="w-full bg-white border border-pink-200 focus:border-pink-500 focus:ring-1 focus:ring-pink-300 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none" /> </div> <div> <label className="block text-[9px] font-bold uppercase text-slate-500 mb-1">App Secret</label> <input type="password" value={payBkashAppSecret} onChange={e => setPayBkashAppSecret(e.target.value)} placeholder="App secret key" className="w-full bg-white border border-pink-200 focus:border-pink-500 focus:ring-1 focus:ring-pink-300 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none" /> </div> <div> <label className="block text-[9px] font-bold uppercase text-slate-500 mb-1">Username</label> <input type="text" value={payBkashUsername} onChange={e => setPayBkashUsername(e.target.value)} placeholder="Merchant username" className="w-full bg-white border border-pink-200 focus:border-pink-500 focus:ring-1 focus:ring-pink-300 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none" /> </div> <div> <label className="block text-[9px] font-bold uppercase text-slate-500 mb-1">Password</label> <input type="password" value={payBkashPassword} onChange={e => setPayBkashPassword(e.target.value)} placeholder="Merchant password" className="w-full bg-white border border-pink-200 focus:border-pink-500 focus:ring-1 focus:ring-pink-300 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none" /> </div> </div> <p className="text-[9px] text-pink-500 italic">Credentials are stored locally and sent server-side only. Never exposed to browser clients.</p> <GwTestBtn gw="bkash" onClick={() => handleTestGateway('bkash', { appKey: payBkashAppKey, appSecret: payBkashAppSecret, username: payBkashUsername, password: payBkashPassword, sandbox: String(payBkashSandbox) })} disabled={!payBkashAppKey || !payBkashAppSecret || !payBkashUsername || !payBkashPassword} /> </div> )}
 </div> {/* GATEWAY 5: AUTOMATIC NAGAD PORTAL */}
 <div className="space-y-3.5 border-t pt-4 border-slate-200"> <div className="flex items-center justify-between"> <div className="flex items-center gap-2"> <input
 type="checkbox"
 id="pay-nagad-auto-en"
 checked={payNagadAuto}
 onChange={(e) => setPayNagadAuto(e.target.checked)}
 className="scale-110 accent-orange-600 rounded cursor-pointer"
 /> <label htmlFor="pay-nagad-auto-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700 flex items-center gap-1.5"> <span className="text-orange-600 text-sm">৳</span> Nagad Automatic API Gateway
 </label> </div> <span className="text-[8px] bg-orange-50 border border-orange-200 text-orange-700 rounded px-1.5 py-0.5 font-bold uppercase">Instant Settlement</span> </div> {payNagadAuto && (
 <div className="space-y-2.5 bg-orange-50 border border-orange-200 rounded-xl p-3.5"> <p className="text-[10px] text-orange-700 font-semibold"> Enter your Nagad Merchant API credentials from the <a href="https://nagad.com.bd/merchant" target="_blank" className="underline">Nagad Merchant Portal</a>.
 </p> <div className="flex items-center gap-2 mb-1"> <input type="checkbox" id="nagad-sandbox" checked={payNagadSandbox} onChange={e => setPayNagadSandbox(e.target.checked)} className="accent-orange-600 cursor-pointer" /> <label htmlFor="nagad-sandbox" className="text-[10px] font-bold uppercase text-orange-700 cursor-pointer">Sandbox / Test Mode</label> </div> <div className="grid grid-cols-1 gap-2"> <div> <label className="block text-[9px] font-bold uppercase text-slate-500 mb-1">Merchant ID</label> <input type="text" value={payNagadMerchantId} onChange={e => setPayNagadMerchantId(e.target.value)} placeholder="e.g. 683002007104225" className="w-full bg-white border border-orange-200 focus:border-orange-500 focus:ring-1 focus:ring-orange-300 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none" /> </div> <div> <label className="block text-[9px] font-bold uppercase text-slate-500 mb-1">Merchant Private Key (PGP RSA)</label> <textarea value={payNagadPrivateKey} onChange={e => setPayNagadPrivateKey(e.target.value)} rows={3} placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----" className="w-full bg-white border border-orange-200 focus:border-orange-500 focus:ring-1 focus:ring-orange-300 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none resize-none" /> </div> <div> <label className="block text-[9px] font-bold uppercase text-slate-500 mb-1">Nagad Public Key (for response verification)</label> <textarea value={payNagadPublicKey} onChange={e => setPayNagadPublicKey(e.target.value)} rows={3} placeholder="-----BEGIN PUBLIC KEY-----&#10;...&#10;-----END PUBLIC KEY-----" className="w-full bg-white border border-orange-200 focus:border-orange-500 focus:ring-1 focus:ring-orange-300 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none resize-none" /> </div> </div> <p className="text-[9px] text-orange-500 italic">Keys are never sent to the browser. All Nagad API calls are proxied through your server.</p> <GwTestBtn gw="nagad" onClick={() => handleTestGateway('nagad', { merchantId: payNagadMerchantId, privateKey: payNagadPrivateKey, publicKey: payNagadPublicKey, sandbox: String(payNagadSandbox) })} disabled={!payNagadMerchantId || !payNagadPrivateKey} /> </div> )}
 </div>

 {/* ===================================================================== */}
 {/* === ADDITIONAL CHECKOUT CHANNELS (v5.7) === */}
 {/* Paytm / UPI / JazzCash / Easypaisa / PayFast                       */}
 {/* All credentials live ONLY in the admin panel — never in code.      */}
 {/* ===================================================================== */}
 <div className="bg-sky-50/40 border border-dashed border-sky-200 rounded-xl p-4 space-y-4 mt-4">
   <div>
     <h4 className="text-[11px] font-extrabold uppercase text-sky-700 tracking-wider">Additional Checkout Channels</h4>
     <p className="text-[9px] text-slate-500 mt-0.5">Toggle on the gateways you accept and paste in the credentials from each provider's merchant dashboard. Leave a card disabled to hide it from checkout.</p>
   </div>

   {/* Paytm */}
   <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
     <div className="flex items-center justify-between">
       <div className="flex items-center gap-2">
         <input type="checkbox" id="pay-paytm-en" checked={payPaytm} onChange={(e) => setPayPaytm(e.target.checked)} className="scale-110 accent-blue-600 rounded cursor-pointer" />
         <label htmlFor="pay-paytm-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700">Paytm (India)</label>
       </div>
       {payPaytm && (
         <label className="flex items-center gap-1.5 bg-slate-50 border px-2 py-1 rounded-lg cursor-pointer">
           <span className="text-[9px] font-extrabold text-slate-500 uppercase">Sandbox:</span>
           <input type="checkbox" checked={payPaytmSandbox} onChange={(e) => setPayPaytmSandbox(e.target.checked)} className="accent-slate-900 cursor-pointer" />
         </label>
       )}
     </div>
     {payPaytm && (
       <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-fade-in">
         <div>
           <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Merchant ID (MID)</label>
           <input type="text" value={payPaytmMid} onChange={(e) => setPayPaytmMid(e.target.value)} placeholder="e.g. ABCDEF1234567890" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs" />
         </div>
         <div>
           <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Merchant Key</label>
           <input type="password" value={payPaytmKey} onChange={(e) => setPayPaytmKey(e.target.value)} placeholder="Merchant Key" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono" />
         </div>
         <p className="md:col-span-2 text-[9px] text-slate-500">Get credentials from <a className="underline" target="_blank" rel="noopener" href="https://dashboard.paytm.com/next/apikeys">dashboard.paytm.com → API Keys</a>.</p>
         <div className="md:col-span-2"><GwTestBtn gw="paytm" onClick={() => handleTestGateway('paytm', { mid: payPaytmMid, key: payPaytmKey })} disabled={!payPaytmMid || !payPaytmKey} /></div>
       </div>
     )}
   </div>

   {/* UPI manual */}
   <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
     <div className="flex items-center gap-2">
       <input type="checkbox" id="pay-upi-en" checked={payUpi} onChange={(e) => setPayUpi(e.target.checked)} className="scale-110 accent-emerald-600 rounded cursor-pointer" />
       <label htmlFor="pay-upi-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700">UPI (India — GPay / PhonePe / Paytm)</label>
     </div>
     {payUpi && (
       <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-fade-in">
         <div>
           <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">UPI ID (VPA)</label>
           <input type="text" value={payUpiId} onChange={(e) => setPayUpiId(e.target.value)} placeholder="merchant@oksbi" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono" />
         </div>
         <div>
           <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Payee Name</label>
           <input type="text" value={payUpiName} onChange={(e) => setPayUpiName(e.target.value)} placeholder="Your store name" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs" />
         </div>
         <div className="md:col-span-2">
           <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">QR Code Image URL (optional)</label>
           <input type="text" value={payUpiQr} onChange={(e) => setPayUpiQr(e.target.value)} placeholder="https://.../upi-qr.png" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs" />
         </div>
         <div className="md:col-span-2">
           <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Customer instructions</label>
           <textarea value={payUpiInstr} onChange={(e) => setPayUpiInstr(e.target.value)} rows={2} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs" />
         </div>
       </div>
     )}
   </div>

   {/* JazzCash */}
   <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
     <div className="flex items-center justify-between">
       <div className="flex items-center gap-2">
         <input type="checkbox" id="pay-jazz-en" checked={payJazz} onChange={(e) => setPayJazz(e.target.checked)} className="scale-110 accent-red-600 rounded cursor-pointer" />
         <label htmlFor="pay-jazz-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700">JazzCash (Pakistan)</label>
       </div>
       {payJazz && (
         <label className="flex items-center gap-1.5 bg-slate-50 border px-2 py-1 rounded-lg cursor-pointer">
           <span className="text-[9px] font-extrabold text-slate-500 uppercase">Sandbox:</span>
           <input type="checkbox" checked={payJazzSandbox} onChange={(e) => setPayJazzSandbox(e.target.checked)} className="accent-slate-900 cursor-pointer" />
         </label>
       )}
     </div>
     {payJazz && (
       <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-fade-in">
         <div>
           <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Merchant ID</label>
           <input type="text" value={payJazzMid} onChange={(e) => setPayJazzMid(e.target.value)} placeholder="MC12345" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs" />
         </div>
         <div>
           <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Password</label>
           <input type="password" value={payJazzPwd} onChange={(e) => setPayJazzPwd(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono" />
         </div>
         <div className="md:col-span-2">
           <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Integrity Salt (HMAC key)</label>
           <input type="password" value={payJazzSalt} onChange={(e) => setPayJazzSalt(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono" />
         </div>
         <p className="md:col-span-2 text-[9px] text-slate-500">Get credentials from <a className="underline" target="_blank" rel="noopener" href="https://sandbox.jazzcash.com.pk/">sandbox.jazzcash.com.pk</a> → Integration Setup.</p>
         <div className="md:col-span-2"><GwTestBtn gw="jazzcash" onClick={() => handleTestGateway('jazzcash', { mid: payJazzMid, password: payJazzPwd, integeritySalt: payJazzSalt, sandbox: String(payJazzSandbox) })} disabled={!payJazzMid || !payJazzPwd} /></div>
       </div>
     )}
   </div>

   {/* Easypaisa */}
   <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
     <div className="flex items-center justify-between">
       <div className="flex items-center gap-2">
         <input type="checkbox" id="pay-easy-en" checked={payEasy} onChange={(e) => setPayEasy(e.target.checked)} className="scale-110 accent-green-600 rounded cursor-pointer" />
         <label htmlFor="pay-easy-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700">Easypaisa (Pakistan)</label>
       </div>
       {payEasy && (
         <label className="flex items-center gap-1.5 bg-slate-50 border px-2 py-1 rounded-lg cursor-pointer">
           <span className="text-[9px] font-extrabold text-slate-500 uppercase">Sandbox:</span>
           <input type="checkbox" checked={payEasySandbox} onChange={(e) => setPayEasySandbox(e.target.checked)} className="accent-slate-900 cursor-pointer" />
         </label>
       )}
     </div>
     {payEasy && (
       <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-fade-in">
         <div>
           <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Store ID</label>
           <input type="text" value={payEasyStore} onChange={(e) => setPayEasyStore(e.target.value)} placeholder="e.g. 12345" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs" />
         </div>
         <div>
           <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Hash Key</label>
           <input type="password" value={payEasyHash} onChange={(e) => setPayEasyHash(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono" />
         </div>
         <p className="md:col-span-2 text-[9px] text-slate-500">Get credentials from <a className="underline" target="_blank" rel="noopener" href="https://easypaystg.easypaisa.com.pk/">Easypaisa Merchant Portal</a>.</p>
         <div className="md:col-span-2"><GwTestBtn gw="easypaisa" onClick={() => handleTestGateway('easypaisa', { storeId: payEasyStore, hashKey: payEasyHash, sandbox: String(payEasySandbox) })} disabled={!payEasyStore || !payEasyHash} /></div>
       </div>
     )}
   </div>

   {/* PayFast */}
   <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
     <div className="flex items-center justify-between">
       <div className="flex items-center gap-2">
         <input type="checkbox" id="pay-pf-en" checked={payPf} onChange={(e) => setPayPf(e.target.checked)} className="scale-110 accent-amber-600 rounded cursor-pointer" />
         <label htmlFor="pay-pf-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700">PayFast (South Africa)</label>
       </div>
       {payPf && (
         <label className="flex items-center gap-1.5 bg-slate-50 border px-2 py-1 rounded-lg cursor-pointer">
           <span className="text-[9px] font-extrabold text-slate-500 uppercase">Sandbox:</span>
           <input type="checkbox" checked={payPfSandbox} onChange={(e) => setPayPfSandbox(e.target.checked)} className="accent-slate-900 cursor-pointer" />
         </label>
       )}
     </div>
     {payPf && (
       <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-fade-in">
         <div>
           <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Merchant ID</label>
           <input type="text" value={payPfMid} onChange={(e) => setPayPfMid(e.target.value)} placeholder="10000100" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs" />
         </div>
         <div>
           <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Merchant Key</label>
           <input type="password" value={payPfKey} onChange={(e) => setPayPfKey(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono" />
         </div>
         <div className="md:col-span-2">
           <label className="block text-[9px] font-extrabold text-slate-500 uppercase mb-0.5">Passphrase (optional but recommended)</label>
           <input type="password" value={payPfPass} onChange={(e) => setPayPfPass(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono" />
         </div>
         <p className="md:col-span-2 text-[9px] text-slate-500">Get credentials from <a className="underline" target="_blank" rel="noopener" href="https://merchant.payfast.io/integration/">PayFast Dashboard → Integration</a>.</p>
         <div className="md:col-span-2"><GwTestBtn gw="payfast" onClick={() => handleTestGateway('payfast', { merchantId: payPfMid, merchantKey: payPfKey, passPhrase: payPfPass, sandbox: String(payPfSandbox) })} disabled={!payPfMid || !payPfKey} /></div>
       </div>
     )}
   </div>
 </div>

 {/* ===== PAYMENT METHOD BRANDING SECTION ===== */}
  <div className="bg-violet-50/30 border border-dashed border-violet-200 rounded-xl p-4 space-y-4"> <div> <h4 className="text-[11px] font-extrabold uppercase text-violet-700 tracking-wider"> Payment Method Logos</h4> <p className="text-[9px] text-slate-500 mt-0.5">Upload a logo image for each payment method directly from your device. The logo replaces the built-in default. Leave blank to keep the built-in transparent logo.</p> <p className="text-[9px] text-violet-600 font-semibold mt-0.5"> Recommended size: <strong>300 × 100 px</strong> (PNG/SVG, transparent background, max 300KB) — landscape/horizontal logos work best.</p> </div> {/* Helper: one row per payment method (logo only) */}
  {[
  { label:'bKash Instant (Auto)', logoVal: brandBkashAutoLogo, setLogo: setBrandBkashAutoLogo },
  { label:'Nagad Instant (Auto)', logoVal: brandNagadAutoLogo, setLogo: setBrandNagadAutoLogo },
  { label:'PayPal Express', logoVal: brandPaypalLogo, setLogo: setBrandPaypalLogo },
  { label:'Stripe Card', logoVal: brandStripeLogo, setLogo: setBrandStripeLogo },
  { label:'Cash on Delivery', logoVal: brandCodLogo, setLogo: setBrandCodLogo },
  { label:'bKash Manual', logoVal: brandBkashLogo, setLogo: setBrandBkashLogo },
  { label:'Nagad Manual', logoVal: brandNagadLogo, setLogo: setBrandNagadLogo },
  { label:'Rocket Manual', logoVal: brandRocketLogo, setLogo: setBrandRocketLogo },
  { label:'Bank Transfer', logoVal: brandBankLogo, setLogo: setBrandBankLogo },
  { label:'Manual Invoice', logoVal: brandCreditManualLogo, setLogo: setBrandCreditManualLogo },
  { label:'SSLCommerz', logoVal: brandSslcommerzLogo, setLogo: setBrandSslcommerzLogo },
  { label:'Razorpay', logoVal: brandRazorpayLogo, setLogo: setBrandRazorpayLogo },
  { label:'Paytm (India)', logoVal: brandPaytmLogo, setLogo: setBrandPaytmLogo },
  { label:'UPI (India)', logoVal: brandUpiLogo, setLogo: setBrandUpiLogo },
  { label:'JazzCash (Pakistan)', logoVal: brandJazzCashLogo, setLogo: setBrandJazzCashLogo },
  { label:'Easypaisa (Pakistan)', logoVal: brandEasypaisaLogo, setLogo: setBrandEasypaisaLogo },
  { label:'PayFast (South Africa)', logoVal: brandPayFastLogo, setLogo: setBrandPayFastLogo },
  ].map(({ label, logoVal, setLogo }) => (
  <div key={label} className="bg-white border border-slate-100 rounded-lg p-2.5 space-y-1.5">
    <label className="block text-[9px] font-extrabold text-slate-500 uppercase">{label}</label>
    <div className="flex items-center gap-2 flex-wrap">
      <label className="flex items-center gap-1 cursor-pointer px-2.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-[9px] font-bold uppercase rounded-lg transition-colors flex-shrink-0 select-none">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12V4m0 0l-3 3m3-3l3 3"/></svg>
        Upload
        <input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp,image/gif" className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePaymentLogoUpload(f, setLogo, (msg) => toast.error(msg)); e.target.value=''; }}
        />
      </label>
      <input
        type="text"
        value={logoVal.startsWith('data:') ? '' : logoVal}
        onChange={(e) => setLogo(e.target.value)}
        placeholder="…or paste URL"
        className="flex-1 min-w-[100px] bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-violet-400"
      />
      {logoVal && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="flex items-center justify-center h-10 w-[100px] rounded-lg border border-slate-200 bg-slate-50 p-1 overflow-hidden">
            <img src={logoVal} alt="preview" className="h-full w-auto max-w-full object-contain" style={{ imageRendering: 'crisp-edges' }} onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }} />
          </div>
          <button onClick={() => setLogo('')} className="text-[9px] text-slate-400 hover:text-rose-500 cursor-pointer leading-none">✕</button>
        </div>
      )}
    </div>
  </div>
))}

 </div> <div className="pt-3 border-t border-slate-100"> <button
 onClick={handleSavePaymentsCMS}
 className="w-full sm:w-auto cursor-pointer flex items-center justify-center gap-1.5 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-sans font-semibold uppercase text-xs shadow-sm rounded-lg transition-colors"
 > <Save className="w-4 h-4" /> <span>Save Payments Configuration</span> </button> </div> </div> </div> )}

 {/* SECTION: TAWK.TO LIVE SUPPORT ID CHAT */}
 {settingsSection ==='support' && (
 <div className="space-y-4"> <h4 className="text-xs font-bold uppercase text-slate-400"> LIVE SUPPORT CHAT</h4> <p className="text-xs text-slate-400 font-semibold leading-relaxed">Directly inject your Tawk.to static chat widgets to enable shoppers write to your customer support teams in real time.</p> <div className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200"> <input
 type="checkbox"
 id="supp-en"
 checked={supportEnabled}
 onChange={(e) => setSupportEnabled(e.target.checked)}
 className="scale-110 accent-emerald-650 rounded cursor-pointer"
 /> <label htmlFor="supp-en" className="text-xs font-bold uppercase cursor-pointer text-slate-700">Activate Tawk.to support widget</label> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Tawk.to Property ID / Widget link ID (e.g. 642xxxx/1gxxxxx)</label> <input
 type="text"
 value={supportId}
 onChange={(e) => setSupportId(e.target.value)}
 placeholder="e.g. 642a42dfacxxxx/default"
 className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-all"
 /> </div> <div className="pt-3 border-t border-slate-100"> <button
 onClick={handleSaveSupportCMS}
 className="w-full sm:w-auto cursor-pointer flex items-center justify-center gap-1.5 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-sans font-semibold uppercase text-xs shadow-sm rounded-lg transition-colors"
 > <Save className="w-4 h-4" /> <span>Initialize support widget</span> </button> </div> </div> )}

 {/* SECTION: SECURITY & CREDENTIALS UPDATES */}
 {settingsSection ==='security' && (
 <div className="space-y-4"> <h4 className="text-xs font-bold uppercase text-slate-400"> RE-KEY CREDENTIALS KEYS</h4> <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">New Administrator Username</label> <input
 type="text"
 value={secUsername}
 onChange={(e) => setSecUsername(e.target.value)}
 autoCapitalize="off"
 autoCorrect="off"
 spellCheck={false}
 className="w-full bg-slate-50 border border-slate-200 focus:border-rose-400 focus:ring-1 focus:ring-rose-400 rounded-lg px-2.5 py-1.5 text-xs font-semibold normal-case text-rose-600 transition-all outline-none"
 /> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">New Administrator Password</label> <div className="relative"> <input
 type={showSecPass ? 'text' : 'password'}
 value={secPass}
 onChange={(e) => setSecPass(e.target.value)}
 placeholder="Enter new password"
 className="w-full bg-slate-50 border border-slate-200 focus:border-rose-400 focus:ring-1 focus:ring-rose-400 rounded-lg pl-2.5 pr-9 py-1.5 text-xs font-semibold text-rose-600 transition-all outline-none"
 /> <button
 type="button"
 onClick={() => setShowSecPass(v => !v)}
 className="absolute inset-y-0 right-0 flex items-center px-2 text-slate-400 hover:text-rose-500 cursor-pointer"
 tabIndex={-1}
 aria-label={showSecPass ? 'Hide password' : 'Show password'}
 > {showSecPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} </button> </div> </div>
 {/* ── RESET SECURE KEYS BUTTON — right below credentials ── */}
 <div className="pt-3">
   <button
     onClick={handleSaveSecurityCMS}
     className="w-full sm:w-auto cursor-pointer flex items-center justify-center gap-1.5 px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-sans font-semibold uppercase text-xs shadow-sm rounded-lg transition-colors"
   >
     <KeyRound className="w-4 h-4" /> <span>Reset Secure Keys</span>
   </button>
 </div>
 </div> {/* Google Sign-In Configuration */}
 <div className="pt-4 border-t border-slate-100"> <h4 className="text-xs font-bold uppercase text-slate-400 mb-3"> Google Sign-In</h4> <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 mb-3 text-[10px] text-blue-700 font-medium leading-relaxed"> <strong>Setup:</strong> Go to{''}
 <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="underline font-bold">Google Cloud Console</a> {''}→ APIs &amp; Services → Credentials → Create OAuth 2.0 Client ID. Set the <strong>Authorized JavaScript origins</strong> to your site domain and paste the Client ID below.
 </div> <div className="flex items-center gap-3 mb-3"> <label className="flex items-center gap-2 cursor-pointer select-none"> <div
 onClick={() => setGoogleSignInEnabled(!googleSignInEnabled)}
 className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${googleSignInEnabled ?'bg-blue-500' :'bg-slate-300'}`}
 > <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${googleSignInEnabled ?'translate-x-5' :'translate-x-0'}`} /> </div> <span className="text-xs font-semibold text-slate-600"> {googleSignInEnabled ?'Enabled — Google Sign-In visible to customers' :'Disabled — Google Sign-In hidden'}
 </span> </label> </div> {googleSignInEnabled && (
 <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Google OAuth Client ID</label> <input
 type="text"
 value={googleClientId}
 onChange={(e) => setGoogleClientId(e.target.value)}
 placeholder="xxxxxxxxxxxxxxxx.apps.googleusercontent.com"
 className="w-full bg-slate-50 border border-slate-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 rounded-lg px-2.5 py-1.5 text-xs font-mono text-blue-700 transition-all outline-none"
 /> <p className="text-[10px] text-slate-400 mt-1">Paste the Client ID from your Google Cloud OAuth 2.0 credentials.</p> </div> )}
 <div className="pt-3">
   <button
     onClick={handleSaveGoogleCMS}
     className="w-full sm:w-auto cursor-pointer flex items-center justify-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-sans font-semibold uppercase text-xs shadow-sm rounded-lg transition-colors"
   >
     <Save className="w-4 h-4" /><span>Save Google Sign-In</span>
   </button>
 </div>
 </div>

 {/* reCAPTCHA Configuration */}
 <div className="pt-4 border-t border-slate-100">
   <h4 className="text-xs font-bold uppercase text-slate-400 mb-3">reCAPTCHA (Bot Protection)</h4>
   <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2.5 mb-3 text-[10px] text-yellow-800 font-medium leading-relaxed">
     <strong>Setup:</strong> Go to <a href="https://www.google.com/recaptcha/admin/create" target="_blank" rel="noopener noreferrer" className="underline font-bold">Google reCAPTCHA Console</a> → Create a new site → Choose <strong>reCAPTCHA v2 "I'm not a robot"</strong> → Add your domain → Copy the <strong>Site Key</strong> below. When enabled, reCAPTCHA appears on Sign In, Sign Up, and Checkout forms.
   </div>
   <div className="flex items-center gap-3 mb-3">
     <label className="flex items-center gap-2 cursor-pointer select-none">
       <div
         onClick={() => setRecaptchaEnabled(!recaptchaEnabled)}
         className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${recaptchaEnabled ? 'bg-yellow-500' : 'bg-slate-300'}`}
       >
         <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${recaptchaEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
       </div>
       <span className="text-xs font-semibold text-slate-600">
         {recaptchaEnabled ? 'Enabled — reCAPTCHA shown on signup/login/checkout' : 'Disabled — reCAPTCHA hidden'}
       </span>
     </label>
   </div>
   {recaptchaEnabled && (
     <>
       <div>
         <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">reCAPTCHA v2 Site Key</label>
         <input
           type="text"
           value={recaptchaSiteKey}
           onChange={(e) => setRecaptchaSiteKey(e.target.value)}
           placeholder="6Lc..."
           className="w-full bg-slate-50 border border-slate-200 focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 rounded-lg px-2.5 py-1.5 text-xs font-mono text-yellow-800 transition-all outline-none"
         />
         <p className="text-[10px] text-slate-400 mt-1">Get this from Google reCAPTCHA Console → Your Site → Site Key (starts with 6Lc...).</p>
       </div>
       <div className="mt-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[10px] text-slate-600">
         <strong className="font-bold">Secret Key (server-side):</strong> Set <code className="font-mono bg-slate-100 px-1 rounded">RECAPTCHA_SECRET_KEY</code> as an environment variable on your server (Vercel / Netlify / Render → Environment Variables). It is never stored here for security reasons.
       </div>
     </>
   )}
 <div className="pt-3">
   <button
     onClick={handleSaveRecaptchaCMS}
     className="w-full sm:w-auto cursor-pointer flex items-center justify-center gap-1.5 px-5 py-2 bg-yellow-500 hover:bg-yellow-600 text-white font-sans font-semibold uppercase text-xs shadow-sm rounded-lg transition-colors"
   >
     <Save className="w-4 h-4" /><span>Save reCAPTCHA</span>
   </button>
 </div>
 </div>

 </div> )}

 {/* SECTION: DELIVERY ZONES */}
 {settingsSection ==='delivery' && (
 <div className="space-y-4"> <div className="flex items-center justify-between"> <h4 className="text-xs font-bold uppercase text-slate-400"> DELIVERY ZONES & SHIPPING RATES</h4> <button
 onClick={() => setLocalZones(prev => [...prev, { id:'dz_' + Date.now(), name:'New Zone', keywords: [], fee: 100, minDays: 3, maxDays: 5, isEnabled: true }])}
 className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold uppercase rounded-lg cursor-pointer transition-colors"
 > <Plus className="w-3 h-3" /> Add Zone
 </button> </div> <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[10px] text-amber-700 font-medium"> Zone with empty keywords acts as catch-all for unrecognized cities. Delivery fee is matched by city name entered at checkout — works for any country worldwide.
 </div> <div className="space-y-3"> {localZones.map((zone, idx) => (
 <div key={zone.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-sm"> <div className="flex items-center justify-between"> <span className="text-[10px] font-bold uppercase text-slate-400">Zone {idx + 1}</span> <div className="flex items-center gap-2"> <label className="flex items-center gap-1.5 cursor-pointer"> <div
 onClick={() => setLocalZones(prev => prev.map((z, i) => i === idx ? { ...z, isEnabled: !z.isEnabled } : z))}
 className={`w-8 h-4 rounded-full transition-colors cursor-pointer ${zone.isEnabled ?'bg-emerald-500' :'bg-slate-300'}`}
 > <div className={`w-3.5 h-3.5 bg-white rounded-full mt-0.5 transition-transform shadow ${zone.isEnabled ?'translate-x-4' :'translate-x-0.5'}`} /> </div> <span className="text-[10px] font-semibold text-slate-500">{zone.isEnabled ?'Active' :'Disabled'}</span> </label> <button
 onClick={() => setLocalZones(prev => prev.filter((_, i) => i !== idx))}
 disabled={localZones.length <= 1}
 className="p-1 text-slate-400 hover:text-rose-500 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
 title="Delete zone"
 > <Trash2 className="w-3.5 h-3.5" /> </button> </div> </div> <div className="grid grid-cols-2 gap-3"> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Zone Name</label> <input
 type="text"
 value={zone.name}
 onChange={(e) => setLocalZones(prev => prev.map((z, i) => i === idx ? { ...z, name: e.target.value } : z))}
 className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:ring-1 focus:ring-emerald-400"
 placeholder="e.g. Capital City"
 /> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Delivery Fee</label> <input
 type="number"
 min={0}
 value={zone.fee}
 onChange={(e) => setLocalZones(prev => prev.map((z, i) => i === idx ? { ...z, fee: Number(e.target.value) } : z))}
 className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:ring-1 focus:ring-emerald-400"
 /> </div> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">City Keywords (comma-separated, lowercase)</label> <input
 type="text"
 value={zone.keywords.join(',')}
 onChange={(e) => setLocalZones(prev => prev.map((z, i) => i === idx ? { ...z, keywords: e.target.value.split(',').map(k => k.trim().toLowerCase()).filter(Boolean) } : z))}
 className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:ring-1 focus:ring-emerald-400"
 placeholder="e.g. london, manchester, birmingham (leave empty = catch-all)"
 /> <p className="text-[9px] text-slate-400 mt-0.5">Leave empty to make this zone the catch-all default for unrecognized cities.</p> </div> <div className="grid grid-cols-2 gap-3"> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Min Delivery Days</label> <input
 type="number"
 min={1}
 value={zone.minDays}
 onChange={(e) => setLocalZones(prev => prev.map((z, i) => i === idx ? { ...z, minDays: Number(e.target.value) } : z))}
 className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:ring-1 focus:ring-emerald-400"
 /> </div> <div> <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Max Delivery Days</label> <input
 type="number"
 min={1}
 value={zone.maxDays}
 onChange={(e) => setLocalZones(prev => prev.map((z, i) => i === idx ? { ...z, maxDays: Number(e.target.value) } : z))}
 className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:ring-1 focus:ring-emerald-400"
 /> </div> </div>
 {/* COD Delivery Fee Prepayment toggle */}
 <label className="flex items-start gap-2.5 cursor-pointer p-2.5 bg-amber-50 border border-amber-200 rounded-lg mt-2">
   <div
     onClick={() => setLocalZones(prev => prev.map((z, i) => i === idx ? { ...z, requireDeliveryFeePrepayment: !z.requireDeliveryFeePrepayment } : z))}
     className={`relative flex-shrink-0 w-8 h-4 rounded-full mt-0.5 transition-colors cursor-pointer ${zone.requireDeliveryFeePrepayment ? 'bg-amber-500' : 'bg-slate-200'}`}
   >
     <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${zone.requireDeliveryFeePrepayment ? 'translate-x-4' : 'translate-x-0.5'}`} />
   </div>
   <div>
     <span className="block text-[10px] font-bold text-amber-700 uppercase">Partial COD — Require Upfront Payment</span>
     <span className="block text-[9px] text-amber-600 mt-0.5">When enabled, COD customers in this zone must pay an upfront amount online before the order is confirmed. The invoice/email shows "Paid online (advance)" + "Due on delivery".</span>
     {zone.requireDeliveryFeePrepayment && (
       <div className="mt-2 flex items-center gap-2">
         <label className="text-[9px] font-bold uppercase text-amber-700">Advance amount</label>
         <input
           type="number"
           min={0}
           step="0.01"
           value={zone.partialCodAmount ?? ''}
           placeholder={`${zone.fee} (defaults to delivery fee)`}
           onChange={(e) => setLocalZones(prev => prev.map((z, i) => i === idx ? { ...z, partialCodAmount: e.target.value === '' ? undefined : Number(e.target.value) } : z))}
           className="w-32 bg-white border border-amber-200 rounded px-2 py-1 text-[11px] font-semibold text-amber-800 outline-none focus:ring-1 focus:ring-amber-400"
         />
         <span className="text-[9px] text-amber-600">Leave blank to use the zone's delivery fee.</span>
       </div>
     )}
   </div>
 </label>
 </div> ))}
 </div> <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 mt-2">
  <h4 className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">Global Fallback Fee &amp; Tax Rate</h4>
  <p className="text-[9px] text-slate-400">Used when no delivery zone matches. Set tax to <strong>0</strong> to completely disable tax.</p>
  <div className="grid grid-cols-2 gap-4">
    <div>
      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Global Base Shipping &amp; Delivery Fee</label>
      <input type="number" min={0} value={payFee} onChange={(e) => setPayFee(Number(e.target.value))} className="w-full bg-white border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none" />
    </div>
    <div>
      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Tax Rate (decimal — 0.09 = 9%, 0 = no tax)</label>
      <input type="number" min={0} max={1} step={0.01} value={payTax} onChange={(e) => setPayTax(Number(e.target.value))} className="w-full bg-white border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none" />
      <p className="text-[9px] text-slate-400 mt-0.5">Enter <strong>0</strong> to remove tax entirely.</p>
    </div>
  </div>
 </div>
 <button
 onClick={async () => {
   await saveDeliveryZonesCtx(localZones);
   // Also persist shipping fee and tax rate (they live in paymentSettings)
   try {
     await savePaymentSettings({
       ...paymentSettings,
       shippingFee: Number(payFee),
       taxPercentage: Number(payTax),
     });
     toast.success('Delivery zones, shipping fee & tax saved.');
   } catch {
     toast.success('Delivery zones saved.');
   }
 }}
 className="w-full sm:w-auto cursor-pointer flex items-center justify-center gap-1.5 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-sans font-semibold uppercase text-xs shadow-sm rounded-lg transition-colors"
 > Save Zones & Rates
 </button> </div> )}

 </div> )}

 {/* ══════════════════════════════════════════════════════════════ */}
 {/* SECTION: FIREBASE INFRASTRUCTURE SETUP */}
 {/* ══════════════════════════════════════════════════════════════ */}

 {/* ── Backend sidebar tab ── */}
 {activeTab === 'backend' && (
   <div className="space-y-6">
     <div className="border-b border-slate-100 pb-4">
       <h3 className="text-lg font-bold text-slate-800 uppercase">Backend Configuration</h3>
       <p className="text-xs text-slate-500 font-medium mt-1">
         Manage which database engine powers the storefront and admin panel.
       </p>
     </div>
     <BackendSection />

     {/* ── MIGRATION EXPORT CARD ── */}
     <div className="rounded-xl border border-teal-200 bg-teal-50 p-5 space-y-3">
       <div>
         <p className="text-xs font-bold text-teal-800 uppercase tracking-wide mb-0.5">Data Migration &amp; Export</p>
         <p className="text-xs text-teal-700 leading-relaxed">
           Export <strong>all your data</strong> (products, categories, reviews, coupons, orders, subscribers)
           as a single JSON file. You can import this file into any new Fruitopia instance — whether it runs
           on <strong>Firebase</strong> or <strong>Supabase</strong>. The exported structure maps directly to
           Fruitopia's database schema, so import is hassle-free with no manual data entry.
         </p>
       </div>
        <div className="flex flex-wrap gap-2 pt-1">
         <button
           type="button"
           onClick={exportAllDataJSON}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-[10px] font-bold uppercase rounded-lg shadow-sm transition-colors cursor-pointer whitespace-nowrap"
         >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 4v12m0 0l-4-4m4 4l4-4"/></svg>
           Export All Data (JSON)
         </button>
       </div>
       <div className="bg-white/70 rounded-lg p-3 border border-teal-100">
         <p className="text-[10px] text-teal-700 font-semibold uppercase tracking-wide mb-1">How to import on a new site:</p>
         <ol className="text-[10px] text-teal-600 space-y-0.5 list-decimal list-inside leading-relaxed">
           <li>Export using the button above — saves a <code className="font-mono bg-teal-100 px-1 rounded">fruitopia_full_export_*.json</code> file.</li>
           <li>On your new Fruitopia site, go to <strong>Admin → Backend → Import Data</strong> (below).</li>
           <li>Upload the JSON file — all collections import automatically with correct IDs.</li>
           <li>For Supabase: the JSON keys match the Supabase table column names exactly.</li>
         </ol>
       </div>
     </div>

     {/* ── IMPORT DATA CARD ── */}
     <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 space-y-3">
       <div>
         <p className="text-xs font-bold text-indigo-800 uppercase tracking-wide mb-0.5">Import Data</p>
         <p className="text-xs text-indigo-700 leading-relaxed">
           Upload a <code className="font-mono bg-indigo-100 px-1 rounded text-indigo-800">fruitopia_full_export_*.json</code> file
           exported from any Fruitopia site (Firebase <em>or</em> Supabase).
           All products, categories, coupons, orders, and subscribers load automatically — no manual entry needed.
         </p>
       </div>
        <label className={`inline-flex w-auto items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-colors cursor-pointer select-none whitespace-nowrap ${importStatus === 'loading' ? 'bg-indigo-300 text-white cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'}`}>
         {importStatus === 'loading' ? (
           <><svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Importing…</>
         ) : (
            <><svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M4 8l8-8 8 8M12 4v12"/></svg> Upload &amp; Import JSON</>
         )}
         <input type="file" accept=".json,application/json" className="sr-only" disabled={importStatus === 'loading'} onChange={handleImportJSON} />
       </label>

       {/* Progress bar */}
       {importStatus === 'loading' && importProgress && (
         <div className="space-y-1">
           <div className="w-full bg-indigo-200 rounded-full h-2 overflow-hidden">
             <div className="bg-indigo-600 h-2 rounded-full transition-all duration-300" style={{ width: `${Math.round((importProgress.done / Math.max(importProgress.total, 1)) * 100)}%` }} />
           </div>
           <p className="text-[10px] text-indigo-600 font-semibold text-right">{importProgress.done} / {importProgress.total} records</p>
         </div>
       )}

       {/* Result log */}
       {(importStatus === 'done' || importStatus === 'error' || importLog.length > 0) && (
         <div className={`rounded-lg border p-3 space-y-1 ${importStatus === 'error' ? 'bg-rose-50 border-rose-200' : 'bg-white border-indigo-100'}`}>
           <div className="flex items-center justify-between mb-1">
             <p className={`text-[10px] font-bold uppercase ${importStatus === 'error' ? 'text-rose-700' : 'text-indigo-700'}`}>
               {importStatus === 'done' ? '✓ Import Complete' : importStatus === 'error' ? '✗ Import Failed' : 'Importing…'}
             </p>
             <button type="button" onClick={() => { setImportStatus('idle'); setImportLog([]); setImportProgress(null); }} className="text-[10px] text-slate-400 hover:text-rose-500 cursor-pointer">✕ Clear</button>
           </div>
           {importLog.map((line, i) => (
             <p key={i} className={`text-[10px] font-mono leading-tight ${line.startsWith('Error') ? 'text-rose-600' : 'text-slate-600'}`}>{line}</p>
           ))}
         </div>
       )}
     </div>
   </div>
 )}

 </main> </div> </div> );
};

// ─────────────────────────────────────────────────────────────────────────────
//  Backend management card (Admin Panel → Backend tab)
// ─────────────────────────────────────────────────────────────────────────────
type PingStatus = 'idle' | 'checking' | 'ok' | 'error';

function BackendSection() {
  const { databaseEngine } = useApp();
  const engine = databaseEngine || getActiveEngine();
  const label = engine === 'firebase' ? 'Firebase (Firestore)' :
                engine === 'supabase' ? 'Supabase (Postgres)' : 'Local (browser only)';

  const [busy,       setBusy]       = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  // Health-check state
  const [pingStatus, setPingStatus] = React.useState<PingStatus>('idle');
  const [pingMs,     setPingMs]     = React.useState<number | null>(null);
  const [pingDetail, setPingDetail] = React.useState<string>('');

  async function runHealthCheck() {
    setPingStatus('checking');
    setPingMs(null);
    setPingDetail('');
    const t0 = performance.now();
    try {
      if (engine === 'local') {
        await new Promise(r => setTimeout(r, 80)); // simulate tiny delay
        setPingMs(Math.round(performance.now() - t0));
        setPingDetail('Local mock — no network needed');
        setPingStatus('ok');
        return;
      }

      if (engine === 'firebase') {
        let cfgRes: Response;
        try { cfgRes = await fetch('/firebase-config.json', { signal: AbortSignal.timeout(6000) }); }
        catch {
          setPingMs(Math.round(performance.now() - t0));
          setPingDetail('Server unreachable — run: npm run dev');
          setPingStatus('error');
          return;
        }
        // 404 means optional env vars missing but server IS running
        const cfgBody = await cfgRes.json().catch(() => ({}));
        if (!cfgRes.ok) {
          const missing: string[] = cfgBody.missing || [];
          setPingMs(Math.round(performance.now() - t0));
          setPingDetail(missing.length ? `Server running — add to .env: ${missing.join(', ')}` : 'Server running — set FIREBASE_* vars in .env and restart');
          setPingStatus('error');
          return;
        }
        const cfg = cfgBody;
        const projectId = cfg.projectId || cfg.project_id;
        const apiKey    = cfg.apiKey    || cfg.api_key;
        if (!projectId || !apiKey) {
          setPingMs(Math.round(performance.now() - t0));
          setPingDetail('Firebase config missing projectId/apiKey — check .env file');
          setPingStatus('error');
          return;
        }
        // Ping Firestore REST — 404 is fine (doc absent, but connection alive)
        const fbRes = await fetch(
          `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/_ping/probe?key=${apiKey}`,
          { signal: AbortSignal.timeout(6000) }
        );
        const ms = Math.round(performance.now() - t0);
        if (fbRes.ok || fbRes.status === 404 || fbRes.status === 403) {
          setPingMs(ms);
          const detail403 = fbRes.status === 403
            ? `Connected — Firestore rules active (project: ${projectId}). Deploy firestore.rules to enable full access.`
            : `Firestore reachable — project: ${projectId}`;
          setPingDetail(detail403);
          setPingStatus('ok');
        } else {
          const body = await fbRes.text().catch(() => '');
          setPingMs(ms);
          setPingDetail(`Firestore HTTP ${fbRes.status}${body ? ': ' + body.slice(0, 120) : ''}`);
          setPingStatus('error');
        }
        return;
      }

      if (engine === 'supabase') {
        const cfg = getSupabaseRuntimeConfig() || await resolveSupabaseConfig();
        if (!cfg || !cfg.projectUrl || !cfg.anonKey) {
          setPingMs(Math.round(performance.now() - t0));
          setPingDetail('Server running — add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY) to .env, then restart');
          setPingStatus('error');
          return;
        }
        const res = await fetch(`${cfg.projectUrl}/rest/v1/settings?select=key&limit=1`, {
          headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` },
          signal: AbortSignal.timeout(6000),
        });
        const ms = Math.round(performance.now() - t0);
        // Any HTTP response means Supabase is reachable (4xx = auth/RLS issue, still connected)
        if (res.ok) {
          setPingMs(ms);
          setPingDetail(`Supabase connected — ${cfg.projectUrl}`);
          setPingStatus('ok');
        } else if (res.status === 401 || res.status === 403) {
          setPingMs(ms);
          setPingDetail(`Supabase reachable, but database permissions/RLS rejected the settings probe (HTTP ${res.status})`);
          setPingStatus('error');
        } else if (res.status === 400 || res.status === 404) {
          setPingMs(ms);
          setPingDetail(`Supabase reachable — settings table may not exist yet (HTTP ${res.status})`);
          setPingStatus('ok');
        } else {
          setPingMs(ms);
          setPingDetail(`Supabase HTTP ${res.status}`);
          setPingStatus('error');
        }
        return;
      }
    } catch (err: any) {
      setPingMs(Math.round(performance.now() - t0));
      setPingDetail(err?.message || 'Network error');
      setPingStatus('error');
    }
  }

  // Auto-ping once on mount (and whenever engine changes)
  React.useEffect(() => { runHealthCheck(); }, [engine]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSwitch() {
    setBusy(true);
    try {
      if (engine === 'firebase') {
        await clearInstallLock('firebase');
        clearFirebaseConfig();
        try { localStorage.removeItem(DYNAMIC_FIREBASE_KEY); } catch {}
      } else if (engine === 'supabase') {
        await clearInstallLock('supabase');
        await disconnectSupabase();
      }
      try {
        localStorage.removeItem('fruitopia_installed');
        localStorage.removeItem('fruitopia_active_engine');
      } catch {}
      window.location.href = '/install?reset=1';
    } finally {
      setBusy(false);
    }
  }

  // Derived UI helpers
  const statusColor = {
    idle:     'bg-slate-100 text-slate-500 border-slate-200',
    checking: 'bg-blue-50  text-blue-600  border-blue-200',
    ok:       'bg-emerald-50 text-emerald-700 border-emerald-200',
    error:    'bg-rose-50  text-rose-700   border-rose-200',
  }[pingStatus];

  const engineAccent = engine === 'firebase'
    ? 'border-amber-200 bg-amber-50'
    : engine === 'supabase'
    ? 'border-blue-200 bg-blue-50'
    : 'border-slate-200 bg-slate-50';
  const engineText = engine === 'firebase' ? 'text-amber-800' :
                     engine === 'supabase' ? 'text-blue-800'  : 'text-slate-700';

  return (
    <div className="space-y-5">

      {/* ── Active engine card ── */}
      <div className={`rounded-xl border p-4 ${engineAccent}`}>
        <p className={`text-xs font-bold uppercase mb-1 ${engineText}`}>Active backend</p>
        <p className={`text-lg font-bold ${engineText}`}>{label}</p>
        <p className={`text-xs mt-2 leading-relaxed ${engineText}`}>
          All reads and writes from this admin panel and the storefront go through this engine.
          Switching backends does <strong>not</strong> migrate data — the new backend starts empty
          and the old data stays where it is until you delete it manually.
        </p>
      </div>

      {/* ── Health check card ── */}
      <div className={`rounded-xl border p-4 space-y-3 ${statusColor}`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase mb-0.5">Connection status</p>
            <p className="text-sm font-semibold flex items-center gap-2">
              {pingStatus === 'checking' && (
                <RefreshCw className="w-4 h-4 animate-spin" />
              )}
              {pingStatus === 'ok' && (
                <CheckCircle className="w-4 h-4" />
              )}
              {pingStatus === 'error' && (
                <XCircle className="w-4 h-4" />
              )}
              {pingStatus === 'idle'     && 'Not checked yet'}
              {pingStatus === 'checking' && 'Checking…'}
              {pingStatus === 'ok'       && `Online${pingMs !== null ? ` — ${pingMs} ms` : ''}`}
              {pingStatus === 'error' && (() => {
                const isConfig = pingDetail.includes('add to .env') || pingDetail.includes('config missing') || pingDetail.includes('Config missing') || pingDetail.includes('No Supabase config');
                const label = isConfig ? 'Not configured' : `Unreachable${pingMs !== null ? ` (${pingMs} ms)` : ''}`;
                return label;
              })()}
            </p>
            {pingDetail && (
              <p className="text-xs mt-1 opacity-80 break-all">{pingDetail}</p>
            )}
          </div>
          <button
            onClick={runHealthCheck}
            disabled={pingStatus === 'checking'}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold bg-white disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${pingStatus === 'checking' ? 'animate-spin' : ''}`} />
            {pingStatus === 'checking' ? 'Checking…' : 'Ping'}
          </button>
        </div>
      </div>

      {/* ── Switch / Reconfigure ── */}
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2 rounded-lg text-sm cursor-pointer transition-colors"
        >
          Switch backend / Reconfigure
        </button>
      ) : (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
          <p className="text-sm text-amber-900 font-semibold">Are you sure?</p>
          <p className="text-xs text-amber-800 leading-relaxed">
            This will clear the install lock on <strong>{label}</strong>, log this browser out,
            and send you to the install wizard so you can pick a new backend (Firebase or Supabase)
            and enter fresh credentials. Existing data in the old backend is left untouched.
          </p>
          <div className="bg-amber-100 border border-amber-300 rounded-lg p-3 text-xs text-amber-900 leading-relaxed space-y-1">
            <p className="font-bold">⚠️ Also remove old env vars from your host:</p>
            <p>The browser switch alone is not enough — your server still loads the old backend from <code className="bg-white border border-amber-200 rounded px-1">.env</code> on every restart.</p>
            <p>After clicking below, go to your hosting platform and <strong>delete the old backend's env vars</strong>:</p>
            <ul className="list-disc list-inside space-y-0.5 ml-1">
              <li>Switching <strong>away from Firebase</strong> → delete <code className="bg-white border border-amber-200 rounded px-1">FIREBASE_API_KEY</code>, <code className="bg-white border border-amber-200 rounded px-1">FIREBASE_PROJECT_ID</code>, etc.</li>
              <li>Switching <strong>away from Supabase</strong> → delete <code className="bg-white border border-amber-200 rounded px-1">SUPABASE_URL</code>, <code className="bg-white border border-amber-200 rounded px-1">SUPABASE_ANON_KEY</code>.</li>
            </ul>
            <p>Then redeploy (or restart your server) so the old config is fully gone.</p>
          </div>
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={handleSwitch}
              className="bg-rose-500 hover:bg-rose-600 disabled:bg-gray-300 text-white font-semibold px-4 py-2 rounded-lg text-sm cursor-pointer"
            >
              {busy ? 'Working…' : 'Yes, reconfigure'}
            </button>
            <button
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="bg-white border border-gray-300 text-gray-700 font-semibold px-4 py-2 rounded-lg text-sm cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

