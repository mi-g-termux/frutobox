/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Fruitopia — Adaptive State Hub (AppContext.tsx)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHAT'S NEW IN THIS VERSION
 * ──────────────────────────
 * 1. `databaseEngine` state — tracks the currently active backend
 *    ('local' | 'firebase' | 'supabase') and exposes it to all consumers.
 *
 * 2. `switchDatabaseEngine(engine, credentials)` — the admin-facing action
 *    that hot-swaps the backend without a page reload.  It:
 *      a. Calls `switchActiveDatabaseEngine` from db.ts
 *      b. Tears down old real-time listeners
 *      c. Attaches new real-time listeners for the chosen engine
 *      d. Reloads all data from the new backend
 *      e. Returns a { success, message } result for toast feedback
 *
 * 3. Listener lifecycle management — all active Firebase / Supabase real-time
 *    subscriptions are tracked in module-level refs.  `_destroyAllListeners()`
 *    unsubscribes everything before mounting new ones, preventing memory leaks.
 *
 * 4. `reinitializeFirebase` is retained for backward compatibility with
 *    AdminPanel's existing Firebase section and switches the engine to
 *    'firebase' on success.
 *
 * CHANGES IN THIS REVISION
 * ────────────────────────
 * C1. Firebase Auth sign-in on admin login — after credentials pass, attempts
 *     signInWithEmailAndPassword / createUserWithEmailAndPassword using a
 *     synthetic <username>@fruitopia-admin.internal address.  Failure only
 *     warns — local credentials still work.
 *
 * C2. Firebase Auth sign-out on admin logout — fbSignOut(auth) is called
 *     before clearing the local session.
 *
 * C3. `refreshOrders` — re-fetches orders from the active backend and pushes
 *     them into state.  Exposed on the context type and value.
 *
 * C4. `isFirebaseReady` is now driven by both useState(getIsFirebaseConfigured)
 *     AND a dedicated useEffect that subscribes to onFirebaseReadyChange, so
 *     it updates reactively even when Firebase boots asynchronously after mount.
 *
 * C5. `activeDbEngine` — convenience alias for getActiveEngine() exposed on
 *     the context so consumers can read the raw string without importing db.ts.
 *
 * EXISTING LOGIC UNCHANGED: all cart ops, OTP flows, user auth, email
 * verification, coupon logic, delivery zones, and BroadcastChannel sync
 * are preserved verbatim.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  Product,
  Category,
  Order,
  Coupon,
  NewsletterSubscriber,
  Review,
  SiteSettings,
  SMTPSettings,
  PaymentSettings,
  AdminCredentials,
  SupportSettings,
  CartItem,
  UserProfile,
  SMSSettings,
  EmailVerificationSettings,
  DeliveryZone,
  DatabaseEngine,
  EngineCredentials,
} from '../types';
import {
  dbService,
  DEFAULT_SITE_SETTINGS,
  DEFAULT_SMTP_SETTINGS,
  DEFAULT_PAYMENT_SETTINGS,
  DEFAULT_ADMIN_CREDENTIALS,
  DEFAULT_SUPPORT_SETTINGS,
  DEFAULT_SMS_SETTINGS,
  DEFAULT_EMAIL_VERIFICATION_SETTINGS,
  DEFAULT_PRODUCTS,
  DEFAULT_CATEGORIES,
  DEFAULT_COUPONS,
  DEFAULT_REVIEWS,
  getCurrentUserProfile,
  saveUserProfile,
  setCurrentUserSession,
  getUserProfiles,
  simpleHash,
  hashPassword,
  emailToUserId,
  getDeliveryZones,
  saveDeliveryZones,
  switchActiveDatabaseEngine,
  getActiveEngine,
  onEngineChange,
  saveUserAccount,
  getUserByEmailAccount,
  getUserByPhoneAccount,
  normalizePhoneKey,
} from '../db';
import {
  reinitializeDynamicFirebase,
  onFirebaseReadyChange,
  getIsFirebaseConfigured,
  getDb,
  FirebaseRuntimeConfig,
  auth,
} from '../firebase';
import {
  subscribeProducts,
  subscribeOrders,
  subscribeReviews,
  subscribeCategories,
  subscribeCoupons,
  subscribeNewsletterSubscribers,
  subscribeSiteSettings,
  subscribeSettingsDoc,
  seedDefaultData,
  signInAdmin,
  createAdminAccount,
  signOutAdmin,
  updateAdminPassword,
  onAuthStateChange,
} from '../db';
import {
  onSupabaseReadyChange,
  onSupabaseSettingsChange,
  onSupabaseAnySettingChange,
} from '../supabase';
import { buildInvoicePdfBase64 } from '../lib/invoicePdf';
import { resolveCurrencySymbol } from '../lib/currency';

// ─────────────────────────────────────────────────────────────────────────────
//  CONTEXT TYPE DEFINITION
// ─────────────────────────────────────────────────────────────────────────────

interface AppContextType {
  // Data collections
  products: Product[];
  categories: Category[];
  orders: Order[];
  coupons: Coupon[];
  newsletterSubscribers: NewsletterSubscriber[];
  reviews: Review[];
  siteSettings: SiteSettings;
  smtpSettings: SMTPSettings;
  paymentSettings: PaymentSettings;
  adminSettings: AdminCredentials;
  supportSettings: SupportSettings;
  smsSettings: SMSSettings;
  emailVerificationSettings: EmailVerificationSettings;
  cart: CartItem[];
  appliedCoupon: Coupon | null;
  isAdminLoggedIn: boolean;
  isLoading: boolean;

  // ── NEW: Polymorphic engine API ────────────────────────────────────────────
  /** Currently active database engine */
  databaseEngine: DatabaseEngine;
  /** Hot-swap the backend engine. Returns { success, message } for toast feedback. */
  switchDatabaseEngine: (
    engine: DatabaseEngine,
    credentials: EngineCredentials,
  ) => Promise<{ success: boolean; message: string }>;

  // Product actions
  addProduct: (product: Product) => Promise<void>;
  editProduct: (product: Product) => Promise<void>;
  deleteProduct: (productId: string) => Promise<void>;
  updateProductStock: (productId: string, newStock: number) => Promise<void>;

  // Category actions
  addCategory: (category: Category) => Promise<void>;
  editCategory: (category: Category) => Promise<void>;
  deleteCategory: (categoryId: string) => Promise<void>;

  // Order actions
  placeOrder: (orderData: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'orderStatus' | 'paymentStatus'>) => Promise<Order>;
  updateOrderStatus: (orderId: string, status: Order['orderStatus']) => Promise<void>;
  updateOrderPaymentStatus: (orderId: string, status: Order['paymentStatus']) => Promise<void>;
  deleteOrder: (orderId: string) => Promise<void>;
  editOrderNumber: (orderId: string, newNumber: string) => Promise<void>;
  /** C3: Re-fetch orders from the active backend and push into state. */
  refreshOrders: () => Promise<void>;

  // Coupon actions
  addCoupon: (coupon: Coupon) => Promise<void>;
  deleteCoupon: (couponId: string) => Promise<void>;

  // Newsletter actions
  subscribeNewsletter: (email: string) => Promise<{ success: boolean; message: string }>;
  deleteSubscriber: (id: string) => Promise<void>;

  // Review actions
  addReview: (productId: string, name: string, rating: number, comment: string) => Promise<void>;
  approveReview: (reviewId: string, approve: boolean) => Promise<void>;
  deleteReview: (reviewId: string) => Promise<void>;

  // Settings savers
  saveSiteSettings: (settings: SiteSettings) => Promise<void>;
  saveSMTPSettings: (settings: SMTPSettings) => Promise<void>;
  savePaymentSettings: (settings: PaymentSettings) => Promise<void>;
  saveAdminSettings: (settings: AdminCredentials) => Promise<void>;
  saveSupportSettings: (settings: SupportSettings) => Promise<void>;
  saveSMSSettings: (settings: SMSSettings) => Promise<void>;
  saveEmailVerificationSettings: (settings: EmailVerificationSettings) => Promise<void>;

  // OTP / verification
  sendSmsOtp: (phone: string, email: string) => Promise<{ success: boolean; message: string }>;
  verifySmsOtp: (phone: string, otp: string) => { success: boolean; message: string };
  sendEmailVerification: (email: string) => Promise<{ success: boolean; message: string }>;
  verifyEmailToken: (email: string, token: string) => { success: boolean; message: string };
  isEmailVerified: (email: string) => boolean;

  // Registration OTP (6-digit code sent to email, used during signup flow)
  sendRegistrationOtp: (email: string, name: string) => Promise<{ success: boolean; message: string }>;
  verifyRegistrationOtp: (email: string, otp: string) => { success: boolean; message: string };

  // Checkout-time email OTP (works for both registered & guest emails)
  sendCheckoutEmailOtp: (email: string) => Promise<{ success: boolean; message: string }>;
  verifyCheckoutEmailOtp: (email: string, otp: string) => { success: boolean; message: string };

  // Auto-creates a user account after a successful checkout (if missing)
  // and triggers a password-setup email so the user can pick a password later.
  ensureUserAfterCheckout: (data: {
    email: string; name: string; phone: string;
    address: string; city: string; postalCode?: string; orderId?: string;
  }) => Promise<{ created: boolean; passwordSetupSent: boolean }>;

  // Delivery zones
  deliveryZones: DeliveryZone[];
  getZoneForCity: (city: string) => DeliveryZone;
  saveDeliveryZonesCtx: (zones: DeliveryZone[]) => Promise<void>;

  // Cart actions
  addToCart: (product: Product, selectedVariants?: Record<string, string>, variantPrice?: number) => void;
  removeFromCart: (productId: string) => void;
  updateCartQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  applyCouponCode: (code: string) => { success: boolean; message: string };
  removeCoupon: () => void;

  // Admin auth
  setAdminLoggedIn: (loggedIn: boolean, username?: string, password?: string) => Promise<void>;
  triggerTawkToLoader: () => void;

  // User state
  currentUserEmail: string | null;
  setCurrentUserEmail: (email: string) => void;
  formatPrice: (amount: number) => string;

  // Firebase (retained for backward compat with existing AdminPanel code)
  /** C4: Reactive — updates whenever Firebase boots or is reconfigured. */
  isFirebaseReady: boolean;
  reinitializeFirebase: (config: FirebaseRuntimeConfig) => Promise<{ success: boolean; message: string }>;

  // C5: Raw active engine string for consumers that don't want to import db.ts
  activeDbEngine: string;

  // User auth
  userProfile: UserProfile | null;
  isUserLoggedIn: boolean;
  loginUser: (email: string, password: string, deferSession?: boolean) => Promise<{ success: boolean; message: string }>;
  loginWithGoogle: () => Promise<{ success: boolean; message: string }>;
  registerUser: (profile: UserProfile, password: string) => Promise<{ success: boolean; message: string }>;
  resetUserPassword: (email: string, newPassword: string) => Promise<{ success: boolean; message: string }>;
  sendPasswordOtp: (email: string) => Promise<{ success: boolean; message: string }>;
  verifyPasswordOtp: (email: string, otp: string) => { success: boolean; message: string };
  logoutUser: () => void;
  updateUserProfile: (profile: UserProfile) => Promise<void>;
  checkPhoneAvailability: (phone: string, currentUserId?: string) => Promise<{ available: boolean; message: string }>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// ─────────────────────────────────────────────────────────────────────────────
//  APP PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

export const AppProvider = ({ children }: { children: React.ReactNode }) => {

  // ── Data state ─────────────────────────────────────────────────────────────
  const [products, setProducts]         = useState<Product[]>([]);
  const [categories, setCategories]     = useState<Category[]>([]);
  const [orders, setOrders]             = useState<Order[]>([]);
  const [coupons, setCoupons]           = useState<Coupon[]>([]);
  const [newsletterSubscribers, setNewsletterSubscribers] = useState<NewsletterSubscriber[]>([]);
  const [reviews, setReviews]           = useState<Review[]>([]);
  const readCachedSetting = <T,>(key: string): T | null => {
    try {
      const cached = localStorage.getItem(key);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  };

  const [smtpSettings, setSmtpSettings] = useState<SMTPSettings | null>(() =>
    readCachedSetting<SMTPSettings>('qf_smtpSettings'),
  );
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings | null>(() =>
    readCachedSetting<PaymentSettings>('qf_paymentSettings'),
  );
  const [adminSettings, setAdminSettings] = useState<AdminCredentials | null>(() =>
    readCachedSetting<AdminCredentials>('qf_adminSettings'),
  );
  const [supportSettings, setSupportSettings] = useState<SupportSettings | null>(() =>
    readCachedSetting<SupportSettings>('qf_supportSettings'),
  );
  const [smsSettings, setSMSSettings] = useState<SMSSettings | null>(() =>
    readCachedSetting<SMSSettings>('qf_smsSettings'),
  );
  const [emailVerificationSettings, setEmailVerificationSettings] = useState<EmailVerificationSettings | null>(() =>
    readCachedSetting<EmailVerificationSettings>('qf_emailVerification'),
  );
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>(() => getDeliveryZones());

  const [cart, setCart] = useState<CartItem[]>(() => {
    try { const s = localStorage.getItem('qf_cart'); return s ? JSON.parse(s) : []; }
    catch { return []; }
  });
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);

  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState<boolean>(() => {
    try {
      const s = JSON.parse(localStorage.getItem('qf_admin_session') || 'null');
      return !!(s?.token && s?.expiresAt && Date.now() < s.expiresAt);
    } catch { return false; }
  });

  const [currentUserEmail, setCurrentUserEmailState] = useState<string | null>(() =>
    localStorage.getItem('qf_user_email') || null,
  );
  const [userProfile, setUserProfileState] = useState<UserProfile | null>(() => getCurrentUserProfile());

  // Pre-load siteSettings synchronously from localStorage so settings are
  // available instantly on page load (before any cloud backend responds).
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(() => {
    try { const c = localStorage.getItem('qf_siteSettings'); return c ? JSON.parse(c) : null; }
    catch { return null; }
  });

  // Only show the loading spinner if we have NO cached settings at all
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    try { return !localStorage.getItem('qf_siteSettings'); } catch { return true; }
  });

  // ── Database engine state ──────────────────────────────────────────────────
  /**
   * `databaseEngine` reflects the CURRENTLY ACTIVE and CONNECTED engine.
   * It is initialised from localStorage on mount and updated whenever
   * `switchDatabaseEngine` completes successfully.
   */
  const [databaseEngine, setDatabaseEngine] = useState<DatabaseEngine>(() => getActiveEngine());

  // ── C4: Firebase ready state — reactive via onFirebaseReadyChange ──────────
  const [isFirebaseReady, setIsFirebaseReady] = useState<boolean>(() => getIsFirebaseConfigured());

  // C4: Subscribe to Firebase boot/reconfigure events so isFirebaseReady
  // updates even when Firebase initialises asynchronously after mount.
  useEffect(() => {
    return onFirebaseReadyChange((ready) => setIsFirebaseReady(ready));
  }, []);

  // ── C6: onAuthStateChange — detect Firebase Auth session restore after page refresh ──
  // When the page refreshes, Firebase Auth SDK asynchronously restores the
  // session from IndexedDB. Once restored, we attach the auth-restricted
  // listeners (orders, newsletter) that require isAdmin() to read.
  useEffect(() => {
    const unsub = onAuthStateChange((user) => {
      if (user && isAdminLoggedIn) {
        const email = user.email || '';
        // Only react to admin synthetic email accounts
        if (email.endsWith('@fruitopia-admin.internal')) {
          console.log('[AppContext] Firebase Auth session restored — attaching auth-restricted listeners.');
          if (databaseEngineRef.current === 'firebase' && !authRestrictedListenersAttachedRef.current) {
            authRestrictedListenersAttachedRef.current = true;
            const fn = attachAuthRestrictedListenersRef.current;
            fn();
          }
        }
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  //  LISTENER LIFECYCLE MANAGEMENT
  //  We track all active unsubscribe functions so we can tear them all down
  //  cleanly before mounting listeners for a new engine.
  // ─────────────────────────────────────────────────────────────────────────

  /** Holds all active unsubscribe / cleanup functions for real-time listeners */
  const activeListenersRef = useRef<Array<() => void>>([]);

  /** Tear down every active listener immediately */
  const _destroyAllListeners = () => {
    activeListenersRef.current.forEach((unsub) => {
      try { unsub(); } catch { /* ignore */ }
    });
    activeListenersRef.current = [];
    console.log('[AppContext] All real-time listeners destroyed.');
  };

  /**
   * Attach a realtime listener for siteSettings via db.ts subscribeSiteSettings.
   * When the document changes, update React state so currency and other
   * settings broadcast instantly to all browser clients.
   */
  const _attachFirebaseSettingsListener = () => {
    const unsub = subscribeSiteSettings((updated) => {
      if (updated) {
        // Cloud backend is always source of truth — kill stale localStorage cache
        try { localStorage.removeItem('qf_siteSettings'); } catch {}
        setSiteSettings({ ...DEFAULT_SITE_SETTINGS, ...updated });
      }
    });
    activeListenersRef.current.push(unsub);
    console.log('[AppContext] siteSettings listener attached.');
  };

  /**
   * Attach realtime listeners for products and categories via db.ts.
   * Pushes live data into React state and updates localStorage cache on every change.
   */
  const _attachFirebaseCatalogListeners = () => {
    const unsubProducts = subscribeProducts((list) => {
      setProducts(list);
      try { localStorage.setItem('qf_products', JSON.stringify(list)); } catch {}
      console.log('[AppContext] Products live update:', list.length, 'items');
    });
    activeListenersRef.current.push(unsubProducts);

    const unsubCategories = subscribeCategories((list) => {
      setCategories(list);
      try { localStorage.setItem('qf_categories', JSON.stringify(list)); } catch {}
      console.log('[AppContext] Categories live update:', list.length, 'items');
    });
    activeListenersRef.current.push(unsubCategories);
    console.log('[AppContext] Catalog listeners attached.');
  };

  /**
   * Attach realtime listeners for individual settings documents via db.ts subscribeSettingsDoc.
   * (smtpSettings, paymentSettings, adminSettings, supportSettings, smsSettings, emailVerification)
   * Pushes live data into React state on every change from ANY device.
   */
  const _attachFirebaseSettingsDocListeners = () => {
    const settingsDocs = [
      { key: 'smtpSettings',       setter: setSmtpSettings,                 localKey: 'qf_smtpSettings' },
      { key: 'paymentSettings',    setter: setPaymentSettings,               localKey: 'qf_paymentSettings' },
      { key: 'adminSettings',      setter: setAdminSettings,                 localKey: 'qf_adminSettings' },
      { key: 'supportSettings',    setter: setSupportSettings,               localKey: 'qf_supportSettings' },
      { key: 'smsSettings',        setter: setSMSSettings,                   localKey: 'qf_smsSettings' },
      { key: 'emailVerification',  setter: setEmailVerificationSettings,     localKey: 'qf_emailVerification' },
    ] as const;

    for (const { key, setter, localKey } of settingsDocs) {
      const unsub = subscribeSettingsDoc(key, (data) => {
        if (data) {
          (setter as React.Dispatch<React.SetStateAction<any>>)(data);
          try { localStorage.setItem(localKey, JSON.stringify(data)); } catch {}
        }
      });
      activeListenersRef.current.push(unsub);
    }

    console.log('[AppContext] Settings doc listeners attached (smtp, payment, admin, support, sms, emailVerif).');
  };

  /**
   * Attach a Supabase Realtime listener for siteSettings changes.
   * The `onSupabaseSettingsChange` callback fires whenever the `settings`
   * table row with key='siteSettings' is updated via postgres_changes.
   */
  const _attachSupabaseSettingsListener = () => {
    // siteSettings-specific listener (backward-compat, receives .value directly)
    const unsub = onSupabaseSettingsChange((value: Partial<SiteSettings>) => {
      if (value) {
        setSiteSettings((prev) => ({ ...DEFAULT_SITE_SETTINGS, ...(prev || {}), ...value }));
        console.log('[AppContext] Supabase siteSettings real-time update received.');
      }
    });
    activeListenersRef.current.push(unsub);

    // Generic all-settings listener — covers paymentSettings, smtpSettings, etc.
    const unsubAll = onSupabaseAnySettingChange((key: string, value: unknown) => {
      if (!value) return;
      switch (key) {
        case 'paymentSettings':
          setPaymentSettings(value as PaymentSettings);
          console.log('[AppContext] Supabase paymentSettings real-time update received.');
          break;
        case 'smtpSettings':
          setSmtpSettings(value as SMTPSettings);
          console.log('[AppContext] Supabase smtpSettings real-time update received.');
          break;
        case 'adminSettings':
          setAdminSettings(value as AdminCredentials);
          console.log('[AppContext] Supabase adminSettings real-time update received.');
          break;
        case 'supportSettings':
          setSupportSettings(value as SupportSettings);
          console.log('[AppContext] Supabase supportSettings real-time update received.');
          break;
        case 'smsSettings':
          setSMSSettings(value as SMSSettings);
          console.log('[AppContext] Supabase smsSettings real-time update received.');
          break;
        case 'emailVerification':
          setEmailVerificationSettings(value as EmailVerificationSettings);
          console.log('[AppContext] Supabase emailVerification real-time update received.');
          break;
        default:
          break;
      }
    });
    activeListenersRef.current.push(unsubAll);
    console.log('[AppContext] Supabase all-settings listener attached.');
  };

  /**
   * Phase 2 listeners (newsletter) — deferred until Firebase Auth confirms.
   * These are the only collections that require isAdmin() in Firestore security rules.
   * Uses db.ts subscribeNewsletterSubscribers (engine-agnostic).
   */
  const _attachFirebaseAuthRestrictedListeners = () => {
    if (!getIsFirebaseConfigured()) return;
    const unsubNewsletter = subscribeNewsletterSubscribers((list) => {
      setNewsletterSubscribers(list);
      try { localStorage.setItem('qf_newsletter', JSON.stringify(list)); } catch {}
    });
    activeListenersRef.current.push(unsubNewsletter);
    console.log('[AppContext] Auth-restricted listeners attached (newsletter).');
  };

  /**
   * Attach orders listener for authenticated users via db.ts subscribeOrders.
   * This enables real-time order tracking across devices.
   * Called early in Firebase initialization (not gated by admin auth).
   */
  const _attachOrdersListener = () => {
    if (!getIsFirebaseConfigured()) return;
    const unsubOrders = subscribeOrders((list) => {
      setOrders(list);
      try { localStorage.setItem('qf_orders', JSON.stringify(list)); } catch {}
      console.log('[AppContext] Orders real-time update received:', list.length, 'orders');
    });
    activeListenersRef.current.push(unsubOrders);
    console.log('[AppContext] Orders listener attached (real-time sync enabled).');
  };

  /** Ref used by C6 to attach auth-restricted listeners once Firebase Auth confirms */
  const attachAuthRestrictedListenersRef = useRef(_attachFirebaseAuthRestrictedListeners);
  attachAuthRestrictedListenersRef.current = _attachFirebaseAuthRestrictedListeners;

  /**
   * Track whether auth-restricted listeners have been attached, so they are
   * only attached once even if onAuthStateChanged fires multiple times.
   */
  const authRestrictedListenersAttachedRef = useRef(false);

  /**
   * Mount the appropriate real-time listeners for a given engine.
   * Always calls `_destroyAllListeners` first to prevent double-subscription.
   *
   * ── Split attachment strategy ──
   * Phase 1 (immediate): settings, products, categories, coupons, reviews
   *   → These collections ALLOW unauthenticated reads in Firestore rules.
   * Phase 2 (deferred): orders, newsletter
   *   → These require isAdmin() in Firestore rules, so we wait for C6
   *     onAuthStateChanged to confirm Firebase Auth before attaching.
   */
  const _mountListenersForEngine = async (engine: DatabaseEngine) => {
    _destroyAllListeners();
    authRestrictedListenersAttachedRef.current = false;
    if (engine === 'firebase' && getIsFirebaseConfigured()) {
      await _attachFirebaseSettingsListener();
      await _attachFirebaseCatalogListeners();
      await _attachFirebaseSettingsDocListeners();
      // Coupons + reviews are auth-free — attach immediately via db.ts subscriptions
      try {


// ✅ PROFESSIONAL RESPONSIVE EMAIL TEMPLATES
const DEFAULT_ORDER_CONFIRMATION_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 40px 20px; text-align: center; }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .content { padding: 40px 20px; }
    .section { margin-bottom: 32px; }
    .section h2 { font-size: 18px; color: #1f2937; margin-bottom: 16px; border-bottom: 2px solid #10b981; padding-bottom: 12px; }
    .section p { font-size: 14px; color: #4b5563; line-height: 1.6; margin-bottom: 12px; }
    .price-box { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .price-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 12px; color: #4b5563; }
    .price-row.total { border-top: 1px solid #e5e7eb; padding-top: 12px; font-weight: 600; font-size: 16px; color: #1f2937; }
    .footer { background: #f9fafb; padding: 24px 20px; text-align: center; border-top: 1px solid #e5e7eb; }
    .footer p { font-size: 12px; color: #6b7280; line-height: 1.5; margin-bottom: 8px; }
    @media (max-width: 480px) {
      .content { padding: 24px 16px; }
      .header { padding: 32px 16px; }
      .header h1 { font-size: 24px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 Order Confirmed!</h1>
      <p>Thank you for shopping with {{storeName}}</p>
    </div>
    <div class="content">
      <div class="section">
        <h2>Hi {{customerName}},</h2>
        <p>Your order has been received and is being prepared. We'll keep you updated on its status.</p>
      </div>
      <div class="section">
        <h2>📦 Order Details</h2>
        <p><strong>Order #:</strong> {{orderNumber}}</p>
        <p><strong>Status:</strong> ✅ Confirmed</p>
      </div>
      <div class="price-box">
        <div class="price-row"><span>Subtotal</span><span>{{subtotal}}</span></div>
        <div class="price-row"><span>Delivery Fee</span><span>{{deliveryFee}}</span></div>
        <div class="price-row total"><span>Total Amount</span><span>{{total}}</span></div>
      </div>
    </div>
    <div class="footer">
      <p><strong>{{storeName}}</strong></p>
      <p>Thank you for choosing us!</p>
    </div>
  </div>
</body>
</html>`;

const DEFAULT_ORDER_STATUS_UPDATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; padding: 40px 20px; text-align: center; }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .section p { font-size: 14px; color: #4b5563; line-height: 1.6; margin-bottom: 12px; }
    .footer { background: #f9fafb; padding: 24px 20px; text-align: center; border-top: 1px solid #e5e7eb; }
    .footer p { font-size: 12px; color: #6b7280; }
    @media (max-width: 480px) {
      .header { padding: 32px 16px; }
      .header h1 { font-size: 24px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>{{emoji}} {{status}}</h1>
      <p>Your Order #{{orderNumber}}</p>
    </div>
    <div class="content" style="padding: 40px 20px;">
      <div class="section">
        <p>Hi {{customerName}},</p>
        <p>Your order status has been updated to: <strong>{{status}}</strong></p>
      </div>
    </div>
    <div class="footer">
      <p><strong>{{storeName}}</strong></p>
      <p>Questions? Contact us</p>
    </div>
  </div>
</body>
</html>`;

const DEFAULT_WELCOME_EMAIL = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); color: white; padding: 48px 20px; text-align: center; }
    .header h1 { font-size: 32px; margin-bottom: 8px; }
    .content { padding: 40px 20px; }
    .section p { font-size: 14px; color: #4b5563; line-height: 1.6; margin-bottom: 12px; }
    .footer { background: #f9fafb; padding: 24px 20px; text-align: center; border-top: 1px solid #e5e7eb; }
    .footer p { font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome, {{name}}! 🎉</h1>
      <p>Join {{storeName}}</p>
    </div>
    <div class="content">
      <div class="section">
        <p>Hello {{name}},</p>
        <p>Welcome to {{storeName}}! Your account has been created successfully. Start exploring our amazing products now!</p>
      </div>
    </div>
    <div class="footer">
      <p><strong>{{storeName}}</strong></p>
      <p>Happy shopping! 🛒</p>
    </div>
  </div>
</body>
</html>`;

const DEFAULT_ADMIN_ORDER_ALERT = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 700px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 40px 20px; text-align: center; }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .content { padding: 40px 20px; }
    .footer { background: #f9fafb; padding: 24px 20px; text-align: center; border-top: 1px solid #e5e7eb; }
    .footer p { font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🛒 New Order Alert!</h1>
      <p>Order #{{orderNumber}} from {{customerName}}</p>
    </div>
    <div class="content">
      <p>A new order has been placed.</p>
      <p><strong>Order #:</strong> {{orderNumber}}</p>
      <p><strong>Customer:</strong> {{customerName}}</p>
      <p><strong>Total:</strong> {{total}}</p>
    </div>
    <div class="footer">
      <p>Log in to your admin dashboard to process this order.</p>
    </div>
  </div>
</body>
</html>`;

        const unsubCoupons = subscribeCoupons((list) => {
          setCoupons(list);
          try { localStorage.setItem('qf_coupons', JSON.stringify(list)); } catch {}
        });
        activeListenersRef.current.push(unsubCoupons);

        const unsubReviews = subscribeReviews((list) => {
          setReviews(list);
          try { localStorage.setItem('qf_reviews', JSON.stringify(list)); } catch {}
        });
        activeListenersRef.current.push(unsubReviews);

        console.log('[AppContext] Auth-free listeners attached (coupons, reviews).');
      } catch (err) {
        console.warn('[AppContext] Auth-free listener setup failed:', err);
      }

      // Attach orders listener for real-time tracking (available to authenticated users)
      _attachOrdersListener();

      // Check if auth is already restored — if so, attach restricted listeners now
      if (auth?.currentUser && isAdminLoggedIn && !authRestrictedListenersAttachedRef.current) {
        authRestrictedListenersAttachedRef.current = true;
        _attachFirebaseAuthRestrictedListeners();
      }
    } else if (engine === 'supabase') {
      _attachSupabaseSettingsListener();
    }
    // 'local' engine: no real-time listeners needed; BroadcastChannel handles cross-tab sync
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  REFS FOR CLOSURE-SAFE CALLBACKS
  //  The ready-change listeners below must always reference the latest values
  //  of databaseEngine, loadData, and _mountListenersForEngine.  We store
  //  them in refs to avoid stale closures inside the mount-once useEffect.
  // ─────────────────────────────────────────────────────────────────────────

  const databaseEngineRef = useRef(databaseEngine);
  databaseEngineRef.current = databaseEngine;

  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;

  const mountListenersForEngineRef = useRef(_mountListenersForEngine);
  mountListenersForEngineRef.current = _mountListenersForEngine;

  // ─────────────────────────────────────────────────────────────────────────
  //  FIREBASE / SUPABASE READY LISTENERS + ENGINE-CHANGE REGISTRY
  //  Note: the dedicated C4 useEffect above handles isFirebaseReady updates.
  //  This effect handles data reloads and listener remounting on ready events.
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Firebase ready-state changes — reload data and remount listeners
    const unsubFb = onFirebaseReadyChange((ready) => {
      if (ready) {
        const currentEngine = databaseEngineRef.current;
        // If engine is 'local' but Firebase is now configured, auto-upgrade to 'firebase'
        if (currentEngine === 'local' && getActiveEngine() === 'firebase') {
          console.log('[AppContext] Firebase detected — auto-upgrading from local to firebase engine.');
          setDatabaseEngine('firebase');
          loadDataRef.current();
          mountListenersForEngineRef.current('firebase');
        } else if (currentEngine === 'firebase') {
          console.log('[AppContext] Firebase is now live — reloading data...');
          loadDataRef.current();
          mountListenersForEngineRef.current('firebase');
        }
      }
    });

    // Supabase ready-state changes
    const unsubSb = onSupabaseReadyChange((ready) => {
      if (ready && databaseEngineRef.current === 'supabase') {
        console.log('[AppContext] Supabase is now live — reloading data...');
        loadDataRef.current();
        mountListenersForEngineRef.current('supabase');
      }
    });

    // Engine change events emitted by switchActiveDatabaseEngine in db.ts
    const unsubEngine = onEngineChange((newEngine) => {
      setDatabaseEngine(newEngine);
    });

    return () => {
      unsubFb();
      unsubSb();
      unsubEngine();
      _destroyAllListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  //  DATA LOADING
  // ─────────────────────────────────────────────────────────────────────────

  async function loadData() {
    try {
      const [
        prods, cats, ords, coups, subs, revs,
        site, smtp, pay, adm, supp, smsSet, evSet,
      ] = await Promise.all([
        dbService.getProducts(),
        dbService.getCategories(),
        dbService.getOrders(),
        dbService.getCoupons(),
        dbService.getNewsletterSubscribers(),
        dbService.getReviews(),
        dbService.getSiteSettings(),
        dbService.getSMTPSettings(),
        dbService.getPaymentSettings(),
        dbService.getAdminSettings(),
        dbService.getSupportSettings(),
        dbService.getSMSSettings(),
        dbService.getEmailVerificationSettings(),
      ]);
      setProducts(prods);
      setCategories(cats);
      setOrders(ords);
      setCoupons(coups);
      setNewsletterSubscribers(subs);
      setReviews(revs);
      setSiteSettings(site);
      setSmtpSettings(smtp);
      setPaymentSettings(pay);
      setAdminSettings(adm);
      setSupportSettings(supp);
      setSMSSettings(smsSet);
      setEmailVerificationSettings(evSet);
    } catch (err) {
      console.error('[AppContext] Critical error in loadData:', err);
    } finally {
      setIsLoading(false);
    }
  }

  // Mount: initial data load + attach listeners for the persisted engine
  useEffect(() => {
    loadDataRef.current();
    // Attach listeners for whatever engine was persisted at startup
    const engine = getActiveEngine();
    if (engine !== 'local') {
      mountListenersForEngineRef.current(engine);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ FIREBASE FIX: reload all admin settings after Firebase boots.
  // Checkout Channels uses paymentSettings, so only refreshing SMTP caused
  // payment methods to fall back to defaults until a listener eventually fired.
  // ⚠️ GUARD: Only run when Firebase is actually the active engine.
  //    If Supabase is selected, Firebase will still boot (it always tries),
  //    but we must NOT let its ready event reload data from Firebase and
  //    overwrite what Supabase already loaded.
  useEffect(() => {
    if (!isFirebaseReady) return;
    // Do NOT reload from Firebase if the active engine is Supabase or local
    if (databaseEngineRef.current !== 'firebase') return;

    const reloadCriticalSettings = async () => {
      try {
        const [freshSmtp, freshPayment, freshSupport, freshSms, freshEmailVerification] = await Promise.all([
          dbService.getSMTPSettings(),
          dbService.getPaymentSettings(),
          dbService.getSupportSettings(),
          dbService.getSMSSettings(),
          dbService.getEmailVerificationSettings(),
        ]);
        setSmtpSettings(freshSmtp);
        setPaymentSettings(freshPayment);
        setSupportSettings(freshSupport);
        setSMSSettings(freshSms);
        setEmailVerificationSettings(freshEmailVerification);
        console.log('[AppContext] Admin settings reloaded from Firebase');
      } catch (err) {
        console.warn('[AppContext] Failed to reload admin settings from Firebase:', err);
      }
    };

    reloadCriticalSettings();
  }, [isFirebaseReady]);

  // ─────────────────────────────────────────────────────────────────────────
  //  C3: refreshOrders
  //  Re-fetches orders from the active backend and updates React state.
  // ─────────────────────────────────────────────────────────────────────────

  const refreshOrders = async (): Promise<void> => {
    const fresh = await dbService.getOrders();
    setOrders(fresh);
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  POLYMORPHIC ENGINE SWITCHER
  //  The primary new action exposed to AdminPanel.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Hot-swap the active database engine.
   *
   * Steps:
   *  1. Call `switchActiveDatabaseEngine` in db.ts — handles credential
   *     validation, driver boot, fallback, and localStorage persistence.
   *  2. Update React state with the resulting active engine.
   *  3. Destroy old listeners, mount new ones for the new engine.
   *  4. Reload all data from the new backend.
   *  5. Return { success, message } for toast feedback in AdminPanel.
   */
  const switchDatabaseEngine = useCallback(
    async (
      engine: DatabaseEngine,
      credentials: EngineCredentials,
    ): Promise<{ success: boolean; message: string }> => {
      console.log(`[AppContext] Switching engine → ${engine}`);

      const result = await switchActiveDatabaseEngine(engine, credentials);

      // Update the reactive engine state regardless (result.activeEngine reflects fallback)
      setDatabaseEngine(result.activeEngine);

      // Keep isFirebaseReady in sync
      if (result.activeEngine === 'firebase') {
        setIsFirebaseReady(getIsFirebaseConfigured());
      }

      // Tear down old listeners and attach new ones for the resolved engine
      await _mountListenersForEngine(result.activeEngine);

      // ── AUTO-SEED: If Firebase is empty, upload default products/categories ──
      // This handles the case where admin connects Firebase after initial local
      // setup — the Firebase DB is blank so we seed it with defaults automatically.
      if (result.success && result.activeEngine === 'firebase') {
        try {
          const [existingProducts, existingCategories] = await Promise.all([
            dbService.getProducts(),
            dbService.getCategories(),
          ]);
          const firebaseIsEmpty =
            existingProducts.length === 0 && existingCategories.length === 0;
          if (firebaseIsEmpty) {
            console.log('[AppContext] Firebase is empty — seeding default store data...');
            await seedDefaultData({
              products:   DEFAULT_PRODUCTS,
              categories: DEFAULT_CATEGORIES,
              coupons:    DEFAULT_COUPONS,
              reviews:    DEFAULT_REVIEWS,
            });
            console.log('[AppContext] Default store data seeded successfully.');
          }
        } catch (seedErr) {
          console.warn('[AppContext] Auto-seed to Firebase failed (non-fatal):', seedErr);
        }
      }

      // Reload data from the new backend (picks up seeded data if applicable)
      await loadData();

      return { success: result.success, message: result.message };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ─────────────────────────────────────────────────────────────────────────
  //  USER AUTH (unchanged from original)
  // ─────────────────────────────────────────────────────────────────────────

  const setCurrentUserEmail = (email: string) => {
    const normalized = email.trim().toLowerCase();
    localStorage.setItem('qf_user_email', normalized);
    setCurrentUserEmailState(normalized);
  };

  const findProfileByPhone = async (phone: string): Promise<UserProfile | null> => {
    const phoneKey = normalizePhoneKey(phone);
    if (!phoneKey) return null;

    try {
      const firestoreProfile = await getUserByPhoneAccount(phoneKey);
      if (firestoreProfile) return firestoreProfile;
    } catch (err) {
      console.warn('[findProfileByPhone] Firestore phone lookup failed:', err);
    }

    const profiles = getUserProfiles();
    return Object.values(profiles).find((p) => normalizePhoneKey(p.phone || '') === phoneKey) || null;
  };

  const checkPhoneAvailability = async (phone: string, currentUserId?: string): Promise<{ available: boolean; message: string }> => {
    const phoneKey = normalizePhoneKey(phone);
    if (!phoneKey) return { available: true, message: 'No phone number supplied.' };
    const existing = await findProfileByPhone(phoneKey);
    if (existing && existing.id !== currentUserId) {
      return { available: false, message: 'This phone number is already linked to another account. Please sign in or use a different number.' };
    }
    return { available: true, message: 'Phone number is available.' };
  };

  const loginUser = async (email: string, password: string, deferSession = false): Promise<{ success: boolean; message: string }> => {
    try {
      const emailLower = email.trim().toLowerCase();
      const hash = await hashPassword(password);
      const oldHash = simpleHash(password);
      
      // ✅ Validate hash was generated
      if (!hash || hash.length === 0) {
        return { success: false, message: 'Invalid password format. Please try again.' };
      }
      
      // ✅ Try cloud backend FIRST (source of truth for cross-device login)
      try {
        const firestoreProfile = await getUserByEmailAccount(emailLower);
        if (firestoreProfile) {
          // Check if this is a Google-only OR a guest-checkout account that
          // hasn't set a password yet (ensureUserAfterCheckout creates
          // accounts with passwordHash: '' and emails an OTP-based "set
          // your password" link). Telling a guest-checkout customer to use
          // Google here was misleading and could push them to register a
          // second, separate account for the same email instead of just
          // setting a password on the one they already have.
          if (!firestoreProfile.passwordHash) {
            return { success: false, message: 'This account doesn\'t have a password set yet. Use "Forgot password" to set one (or sign in with Google if that\'s how you placed your order).' };
          }
          const isValid = firestoreProfile.passwordHash === hash || firestoreProfile.passwordHash === oldHash;
          if (!isValid) {
            return { success: false, message: 'Incorrect password.' };
          }
          const loginProfile = firestoreProfile.passwordHash === oldHash && firestoreProfile.passwordHash !== hash
            ? { ...firestoreProfile, passwordHash: hash }
            : firestoreProfile;
          if (loginProfile !== firestoreProfile) {
            await saveUserAccount(loginProfile, { createPhoneIndex: false });
            saveUserProfile(loginProfile);
          }
          if (!deferSession) {
            // ✅ Update localStorage cache on successful Firestore login
            saveUserProfile(loginProfile);
            setCurrentUserSession(emailLower);
            setUserProfileState(loginProfile);
            setCurrentUserEmail(emailLower);
          }
          console.log('[loginUser] ✅ Login successful from Firestore');
          return { success: true, message: 'Welcome back, ' + loginProfile.name + '!' };
        }
      } catch (fbError) { 
        console.warn('[loginUser] Firestore lookup failed:', fbError);
        // Fall through to localStorage
      }
      
      // ✅ Fallback: localStorage cache
      const profiles = getUserProfiles();
      const profile = profiles[emailLower];
      if (!profile) {
        return { success: false, message: 'No account found with this email.' };
      }
      if (!profile.passwordHash) {
        return { success: false, message: 'This account doesn\'t have a password set yet. Use "Forgot password" to set one (or sign in with Google if that\'s how you placed your order).' };
      }
      const localValid = profile.passwordHash === hash || profile.passwordHash === oldHash;
      if (!localValid) {
        return { success: false, message: 'Incorrect password.' };
      }
      const loginProfile = profile.passwordHash === oldHash && profile.passwordHash !== hash
        ? { ...profile, passwordHash: hash }
        : profile;
      if (loginProfile !== profile) saveUserProfile(loginProfile);
      
      if (!deferSession) {
        setCurrentUserSession(emailLower);
        setUserProfileState(loginProfile);
        setCurrentUserEmail(emailLower);
      }
      console.log('[loginUser] ✅ Login successful from localStorage');
      return { success: true, message: 'Welcome back, ' + loginProfile.name + '!' };
    } catch (err: any) {
      console.error('[loginUser] Login error:', err);
      return { success: false, message: 'Login failed. Please try again.' };
    }
  };

  const loginWithGoogle = async (): Promise<{ success: boolean; message: string }> => {
    try {
      if (!adminSettings?.googleSignInEnabled) {
        return { success: false, message: 'Google Sign-In is not enabled. Please contact the administrator.' };
      }
      const clientId = adminSettings?.googleClientId?.trim();
      if (!clientId) {
        return { success: false, message: 'Google Sign-In is not configured. Please contact the administrator.' };
      }

      // ── Google OAuth2 popup flow (no overlay, no One Tap) ─────────────────
      // Uses google.accounts.oauth2.initTokenClient — opens the standard
      // Google account picker in a proper popup window triggered by the button
      // click. Works with any backend (Firebase or Supabase).
      const googleUser = await new Promise<{ email: string; name: string; sub: string }>(
        (resolve, reject) => {
          const initOAuth = () => {
            const g = (window as any).google;
            if (!g?.accounts?.oauth2) { reject(new Error('Google Sign-In script failed to load.')); return; }

            const client = g.accounts.oauth2.initTokenClient({
              client_id: clientId,
              scope: 'openid email profile',
              callback: async (tokenResponse: any) => {
                if (tokenResponse?.error) {
                  reject(new Error(tokenResponse.error_description || tokenResponse.error));
                  return;
                }
                if (!tokenResponse?.access_token) {
                  reject(new Error('No access token returned from Google.'));
                  return;
                }
                try {
                  // Fetch user info using the access token
                  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
                  });
                  if (!userInfoRes.ok) { reject(new Error('Failed to fetch Google user info.')); return; }
                  const info = await userInfoRes.json();
                  resolve({ email: info.email || '', name: info.name || '', sub: info.sub || '' });
                } catch (e: any) {
                  reject(new Error(e?.message || 'Failed to retrieve Google user info.'));
                }
              },
              error_callback: (err: any) => {
                if (err?.type === 'popup_closed') reject(new Error('Sign-in cancelled.'));
                else reject(new Error(err?.message || 'Google sign-in failed.'));
              },
            });

            // requestAccessToken opens the standard popup — no overlay
            client.requestAccessToken({ prompt: 'select_account' });
          };

          if ((window as any).google?.accounts?.oauth2) {
            initOAuth();
          } else {
            const script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            script.onload = initOAuth;
            script.onerror = () => reject(new Error('Failed to load Google Sign-In script.'));
            document.head.appendChild(script);
          }
        }
      );

      const email = googleUser.email.toLowerCase();
      const name = googleUser.name || email.split('@')[0];
      const googleId = googleUser.sub || Date.now().toString(36);

      if (!email) return { success: false, message: 'Google did not return an email address.' };

      // ── Find or create the user account in whichever backend is active ──
      let profile: UserProfile | null = null;
      try {
        profile = await getUserByEmailAccount(email);
      } catch {
        // ignore — fall through to localStorage
      }
      if (!profile) {
        const profiles = getUserProfiles();
        profile = profiles[email] || null;
      }

      if (profile) {
        const merged: UserProfile = { ...profile, name: profile.name || name };
        try { await saveUserAccount(merged, { createPhoneIndex: false }); } catch { /* non-fatal */ }
        saveUserProfile(merged);
        setCurrentUserSession(email);
        setUserProfileState(merged);
        setCurrentUserEmail(email);
        return { success: true, message: `Welcome back, ${merged.name}! 👋` };
      }

      const newProfile: UserProfile = {
        id: googleId,
        name,
        email,
        phone: '',
        address: '',
        city: '',
        passwordHash: '',
        orderIds: [],
      };
      try { await saveUserAccount(newProfile); } catch { /* non-fatal — local cache still works */ }
      saveUserProfile(newProfile);
      setCurrentUserSession(email);
      setUserProfileState(newProfile);
      setCurrentUserEmail(email);
      return { success: true, message: `Welcome, ${name}! 🎉 Your account has been created.` };
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error('[loginWithGoogle] Error:', e?.message);
      return { success: false, message: e?.message || 'Google sign-in failed. Please try again.' };
    }
  };

  const registerUser = async (profile: UserProfile, password: string): Promise<{ success: boolean; message: string }> => {
    try {
      // ✅ CRITICAL: Validate inputs
      if (!password || password.length < 6) {
        return { success: false, message: 'Password must be at least 6 characters.' };
      }
      if (!profile.email || !profile.name) {
        return { success: false, message: 'Email and name are required.' };
      }

      // ✅ Check for existing accounts
      const profiles = getUserProfiles();
      const emailLower = profile.email.toLowerCase();
      if (profiles[emailLower] || await getUserByEmailAccount(emailLower)) {
        return { success: false, message: 'An account already exists with this email.' };
      }

      const phoneKey = normalizePhoneKey(profile.phone || '');
      if (!phoneKey) {
        return { success: false, message: 'Phone number is required.' };
      }
      const phoneCheck = await checkPhoneAvailability(phoneKey);
      if (!phoneCheck.available) {
        return { success: false, message: phoneCheck.message };
      }

      // ✅ CRITICAL: Generate ID and hash password IMMEDIATELY
      // Derived from the email (not a random timestamp) so a raced/duplicate
      // signup attempt for the same address can never produce a second
      // account — see emailToUserId() in db.ts.
      const userId = profile.id || await emailToUserId(emailLower);
      const passwordHash = await hashPassword(password);
      
      // ✅ Verify hash was created and is not empty
      if (!passwordHash || passwordHash.length === 0) {
        console.error('[registerUser] ❌ Password hashing failed - hash is empty!');
        return { success: false, message: 'Failed to process password. Please try again.' };
      }

      // ✅ Create complete profile with ALL required fields
      const newProfile: UserProfile = {
        id: userId,
        name: profile.name,
        email: emailLower,
        phone: profile.phone || '',
        phoneKey,
        address: profile.address || '',
        city: profile.city || '',
        passwordHash: passwordHash, // ✅ ALWAYS SET, NEVER EMPTY OR UNDEFINED
        orderIds: [],
      };

      console.log('[registerUser] Creating account with:', {
        email: newProfile.email,
        name: newProfile.name,
        id: newProfile.id,
        hasPasswordHash: !!newProfile.passwordHash,
        passwordHashLength: newProfile.passwordHash.length,
      });

      // ✅ CRITICAL: Save to active backend first with error handling
      let firebaseWriteSuccess = false;
      try {
        await saveUserAccount(newProfile);
        firebaseWriteSuccess = true;
        console.log('[registerUser] ✅ Successfully saved to active backend with password hash');
      } catch (fbError: any) {
        console.error('[registerUser] ❌ Backend write failed:', fbError?.message);
        // Continue with localStorage fallback
      }

      // ✅ Also save to localStorage cache
      try {
        saveUserProfile(newProfile);
        console.log('[registerUser] ✅ Successfully saved to localStorage cache');
      } catch (cacheError: any) {
        console.error('[registerUser] ⚠️ Local cache save failed:', cacheError?.message);
      }

      // ✅ Set current session
      setCurrentUserSession(emailLower);
      setUserProfileState(newProfile);
      setCurrentUserEmail(emailLower);

      // ✅ Send welcome email asynchronously (non-blocking)
      try {
        const storeName = siteSettings?.websiteName || 'Fruitopia';
        const welcomeHtml = (
          smtpSettings?.welcomeTemplate ||
          `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;background:#f8fafc;border-radius:12px;">
            <div style="text-align:center;font-size:48px;margin-bottom:12px;">🎉</div>
            <h2 style="color:#0f172a;text-align:center;margin:0;">Welcome to ${storeName}!</h2>
            <p style="color:#64748b;text-align:center;font-size:14px;">Hi <strong>{{customerName}}</strong>, your account is all set!</p>
            <div style="background:#fff;border:2px solid #e2e8f0;border-radius:10px;padding:20px;margin:20px 0;text-align:center;">
              <p style="color:#475569;font-size:13px;margin:0;">Start exploring our delicious range of fresh, organic products. Order now and enjoy fast delivery!</p>
            </div>
            <div style="text-align:center;margin-top:20px;">
              <a href="/" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:700;font-size:14px;">Shop Now</a>
            </div>
            <p style="text-align:center;color:#94a3b8;font-size:11px;margin-top:24px;">Thank you for joining ${storeName}!</p>
          </div>`
        ).replace('{{customerName}}', newProfile.name);

        const welcomeSubject = smtpSettings?.welcomeSubject || `Welcome to ${storeName}, ${newProfile.name}!`;

        fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: newProfile.email,
            subject: welcomeSubject,
            html: welcomeHtml,
            smtpSettings: smtpSettings ? { ...smtpSettings, fromName: smtpSettings.fromName || storeName } : null,
          }),
        }).catch(() => {});
      } catch { /* email failure is non-blocking */ }

      return { 
        success: true, 
        message: '🎉 Account created! Welcome, ' + newProfile.name + '!' 
      };
    } catch (err: any) {
      console.error('[registerUser] Unexpected error:', err);
      return { success: false, message: err?.message || 'Account creation failed. Please try again.' };
    }
  };

  const resetUserPassword = async (email: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
    try {
      const key = email.trim().toLowerCase();
      
      // ✅ Validate password
      if (!newPassword || newPassword.length < 6) {
        return { success: false, message: 'Password must be at least 6 characters.' };
      }
      
      // ✅ Hash password IMMEDIATELY and verify
      const newHash = await hashPassword(newPassword);
      if (!newHash || newHash.length === 0) {
        console.error('[resetUserPassword] Password hashing failed - hash is empty!');
        return { success: false, message: 'Failed to process password. Please try again.' };
      }

      // ✅ Try active backend FIRST (source of truth)
      let updated = false;
      try {
        const firestoreProfile = await getUserByEmailAccount(key);
        if (firestoreProfile) {
          const updatedProfile = { ...firestoreProfile, passwordHash: newHash }; // ✅ ALWAYS SET
          
          await saveUserAccount(updatedProfile, { createPhoneIndex: false });
          console.log('[resetUserPassword] ✅ Password updated in active backend');
          
          if (userProfile?.email?.toLowerCase() === key) {
            setUserProfileState(updatedProfile);
          }
          updated = true;
        }
      } catch (firebaseErr) {
        console.warn('[resetUserPassword] Firestore update failed:', firebaseErr);
      }
      
      // ✅ Fall back to localStorage if Firestore unavailable or didn't find account
      if (!updated) {
        const profiles = getUserProfiles();
        const profile = profiles[key];
        if (profile) {
          const updatedProfile = { ...profile, passwordHash: newHash }; // ✅ ALWAYS SET
          
          saveUserProfile(updatedProfile);
          console.log('[resetUserPassword] ✅ Password updated in localStorage');
          
          if (userProfile?.email?.toLowerCase() === key) {
            setUserProfileState(updatedProfile);
          }
          updated = true;
        }
      }
      
      if (!updated) {
        return { success: false, message: 'No account found with this email.' };
      }
      
      deleteOtpEntry(key);
      return { success: true, message: 'Password reset successfully! You can now login with your new password.' };
    } catch (err: any) {
      console.error('[resetUserPassword] Error:', err);
      return { success: false, message: err?.message || 'Failed to reset password. Please try again.' };
    }
  };

  const logoutUser = () => {
    setCurrentUserSession(null);
    setUserProfileState(null);
    setCurrentUserEmailState(null);
    localStorage.removeItem('qf_user_email');
  };

  const updateUserProfile = async (profile: UserProfile) => {
    const phoneCheck = await checkPhoneAvailability(profile.phone || '', profile.id);
    if (!phoneCheck.available) throw new Error(phoneCheck.message);
    await saveUserAccount({ ...profile, phoneKey: normalizePhoneKey(profile.phone || '') }, { createPhoneIndex: false }); // writes to active backend + localStorage cache
    setUserProfileState({ ...profile, phoneKey: normalizePhoneKey(profile.phone || '') });
  };

  // ── OTP store (localStorage-backed) ────────────────────────────────────────
  const OTP_STORAGE_KEY = 'qf_otp_store';
  const getOtpStore = (): Record<string, { code: string; expiresAt: number }> => {
    try { return JSON.parse(localStorage.getItem(OTP_STORAGE_KEY) || '{}'); } catch { return {}; }
  };
  const setOtpEntry = (key: string, entry: { code: string; expiresAt: number }) => {
    try {
      const st = getOtpStore();
      st[key] = entry;
      localStorage.setItem(OTP_STORAGE_KEY, JSON.stringify(st));
    } catch {}
  };
  const deleteOtpEntry = (key: string) => {
    try {
      const st = getOtpStore();
      delete st[key];
      localStorage.setItem(OTP_STORAGE_KEY, JSON.stringify(st));
    } catch {}
  };

  const sendPasswordOtp = async (email: string): Promise<{ success: boolean; message: string }> => {
    const key = email.trim().toLowerCase();
    
    // ✅ Try active backend FIRST (source of truth)
    let userExists = false;
    try {
      const firestoreProfile = await getUserByEmailAccount(email);
      if (firestoreProfile) {
        userExists = true;
      }
    } catch (firebaseErr) {
      console.warn('[Auth] Firestore query failed, checking localStorage:', firebaseErr);
    }
    
    // ✅ Fall back to localStorage if Firestore unavailable
    if (!userExists) {
      const profiles = getUserProfiles();
      if (profiles[key]) {
        userExists = true;
      }
    }
    
    if (!userExists) return { success: false, message: 'No account found with this email. Please register first.' };
    if (smtpSettings?.otpEnabled === false) return { success: false, message: 'OTP password reset is disabled.' };
    
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiryMinutes = smtpSettings?.otpExpiryMinutes || 10;
    setOtpEntry(key, { code, expiresAt: Date.now() + expiryMinutes * 60_000 });
    const storeName = siteSettings?.websiteName || 'Fruitopia';
    
    try {
      const otpHtml = (
        smtpSettings?.otpTemplate ||
        `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;background:#f8fafc;border-radius:12px;">
          <div style="text-align:center;font-size:48px;margin-bottom:12px;">🔐</div>
          <h2 style="color:#0f172a;text-align:center;margin:0;">Password Reset OTP</h2>
          <p style="color:#64748b;text-align:center;font-size:14px;margin:12px 0;">Your password reset code is:</p>
          <div style="background:#fff;border:2px solid #e2e8f0;border-radius:10px;padding:20px;margin:20px 0;text-align:center;">
            <p style="font-size:32px;font-weight:bold;color:#059669;margin:16px 0;letter-spacing:4px;font-family:monospace;">${code}</p>
            <p style="color:#475569;font-size:12px;margin:0;">Valid for ${expiryMinutes} minutes only</p>
          </div>
          <p style="color:#64748b;font-size:12px;margin:12px 0;">If you didn't request this, please ignore this email.</p>
        </div>`
      );
      
      await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: email,
          subject: smtpSettings?.otpSubject || `Your ${storeName} Password Reset Code`,
          html: otpHtml,
          smtpSettings: smtpSettings ? { ...smtpSettings, fromName: smtpSettings.fromName || storeName } : null,
        }),
      });
    } catch { console.log(`[OTP DEV] Code for ${email}: ${code}`); }
    return { success: true, message: `OTP sent to ${email}. Check your inbox.` };
  };

  const verifyPasswordOtp = (email: string, otp: string): { success: boolean; message: string } => {
    const key = email.trim().toLowerCase();
    const entry = getOtpStore()[key];
    if (!entry) return { success: false, message: 'No OTP found. Please request a new one.' };
    if (Date.now() > entry.expiresAt) { deleteOtpEntry(key); return { success: false, message: 'OTP expired. Request a new one.' }; }
    if (entry.code !== otp.trim()) return { success: false, message: 'Incorrect OTP.' };
    return { success: true, message: 'OTP verified!' };
  };

  // ── Email Verification (unchanged) ─────────────────────────────────────────
  const EV_KEY = 'qf_ev_tokens';
  const getEvStore = (): Record<string, { token: string; expiresAt: number; verified: boolean }> => {
    try { return JSON.parse(localStorage.getItem(EV_KEY) || '{}'); } catch { return {}; }
  };

  const isEmailVerified = (email: string): boolean => {
    const st = getEvStore();
    const entry = st[email.toLowerCase()];
    return !!(entry && entry.verified);
  };

  const sendEmailVerification = async (email: string): Promise<{ success: boolean; message: string }> => {
    const evCfg = emailVerificationSettings;
    if (!evCfg?.isEnabled) return { success: true, message: 'Email verification not required.' };

    // Check SMTP is configured before promising an email will arrive
    if (!smtpSettings?.host || !smtpSettings?.email || !smtpSettings?.password) {
      console.warn('[sendEmailVerification] SMTP not configured — verification email cannot be sent.');
      return { success: false, message: 'Email service is not configured. Please contact the store admin to set up SMTP.' };
    }

    const token = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join('');
    const expiryHours = evCfg.tokenExpiryHours || 24;
    const evStore = getEvStore();
    evStore[email.toLowerCase()] = { token, expiresAt: Date.now() + expiryHours * 3600_000, verified: false };
    localStorage.setItem(EV_KEY, JSON.stringify(evStore));

    const storeName = siteSettings?.websiteName || 'Our Store';
    const verifyUrl = `${window.location.origin}/?verify_token=${token}&verify_email=${encodeURIComponent(email)}`;
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:520px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <div style="background:linear-gradient(135deg,#10b981,#059669);padding:32px 24px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:24px;font-weight:800;">${storeName}</h1>
          <p style="color:#d1fae5;margin:8px 0 0;font-size:14px;">Email Verification</p>
        </div>
        <div style="padding:32px 24px;">
          <h2 style="color:#0f172a;margin:0 0 12px;font-size:18px;">Verify your email address</h2>
          <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px;">
            Thanks for signing up! Click the button below to verify your email address. This link expires in <strong>${expiryHours} hours</strong>.
          </p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${verifyUrl}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;">
              ✅ Verify My Email
            </a>
          </div>
          <p style="color:#94a3b8;font-size:12px;text-align:center;margin:20px 0 0;">
            If you didn't create an account, you can safely ignore this email.
          </p>
        </div>
        <div style="background:#f8fafc;padding:16px 24px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="color:#94a3b8;font-size:11px;margin:0;">${storeName} · Sent to ${email}</p>
        </div>
      </div>`;

    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: email,
          subject: `Verify your email — ${storeName}`,
          html,
          smtpSettings: { ...smtpSettings, fromName: smtpSettings.fromName || storeName },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.simulated) {
        // SMTP skipped on server side — inform admin
        console.warn('[sendEmailVerification] SMTP not active on server. Token:', token);
        return { success: false, message: 'SMTP is not active. Configure SMTP in Admin → Settings → SMTP to send verification emails.' };
      }
    } catch (err) {
      console.error('[sendEmailVerification] API call failed:', err);
      return { success: false, message: 'Could not send verification email. Check your internet connection or SMTP settings.' };
    }
    return { success: true, message: `Verification email sent to ${email}. Please check your inbox.` };
  };

  const verifyEmailToken = (email: string, token: string): { success: boolean; message: string } => {
    const evStore = getEvStore();
    const entry = evStore[email.toLowerCase()];
    if (!entry) return { success: false, message: 'No verification pending for this email.' };
    if (Date.now() > entry.expiresAt) return { success: false, message: 'Verification link expired.' };
    if (entry.token !== token.trim()) return { success: false, message: 'Invalid verification token.' };
    evStore[email.toLowerCase()] = { ...entry, verified: true };
    localStorage.setItem(EV_KEY, JSON.stringify(evStore));
    return { success: true, message: 'Email verified successfully!' };
  };

  // ── Checkout-time Email OTP ────────────────────────────────────────────────
  // Works for ANY email (registered or guest). On successful verify, we ALSO
  // flip the EV-store entry to verified=true so the existing isEmailVerified()
  // check used by the "Block Checkout Until Verified" gate also passes.
  const CHECKOUT_OTP_KEY = 'qf_checkout_otp_store';
  const getCheckoutOtpStore = (): Record<string, { code: string; expiresAt: number }> => {
    try { return JSON.parse(localStorage.getItem(CHECKOUT_OTP_KEY) || '{}'); } catch { return {}; }
  };
  const setCheckoutOtpEntry = (key: string, entry: { code: string; expiresAt: number }) => {
    try {
      const st = getCheckoutOtpStore();
      st[key] = entry;
      localStorage.setItem(CHECKOUT_OTP_KEY, JSON.stringify(st));
    } catch {}
  };
  const deleteCheckoutOtpEntry = (key: string) => {
    try {
      const st = getCheckoutOtpStore();
      delete st[key];
      localStorage.setItem(CHECKOUT_OTP_KEY, JSON.stringify(st));
    } catch {}
  };

  const sendCheckoutEmailOtp = async (email: string): Promise<{ success: boolean; message: string }> => {
    const key = (email || '').trim().toLowerCase();
    if (!key || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) {
      return { success: false, message: 'Please enter a valid email address first.' };
    }
    // Use the same admin-configured SMTP pipeline as every other email
    // (welcome, order confirmation, password OTP). If SMTP isn't set,
    // surface that to the user instead of silently "succeeding".
    if (!smtpSettings || !smtpSettings.host || !smtpSettings.email) {
      return { success: false, message: 'Email service is not configured. Please contact the store admin.' };
    }
    if (smtpSettings.otpEnabled === false) {
      return { success: false, message: 'Email OTP verification is disabled by admin.' };
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiryMinutes = smtpSettings?.otpExpiryMinutes || 10;
    setCheckoutOtpEntry(key, { code, expiresAt: Date.now() + expiryMinutes * 60_000 });
    const storeName = siteSettings?.websiteName || 'E-Shop';
    const subject = smtpSettings?.otpSubject
      ? `${smtpSettings.otpSubject} (Checkout)`
      : `Your ${storeName} checkout verification code`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#f8fafc;border-radius:12px;">
        <h2 style="color:#0f172a;margin:0 0 12px;">Verify your email to complete checkout</h2>
        <p style="color:#475569;font-size:14px;">Use the code below to verify your email and place your order at <strong>${storeName}</strong>.</p>
        <div style="background:#fff;border:2px dashed #10b981;border-radius:10px;padding:18px;margin:18px 0;text-align:center;font-size:30px;letter-spacing:8px;font-weight:800;color:#065f46;">${code}</div>
        <p style="color:#64748b;font-size:12px;">This code expires in ${expiryMinutes} minutes. If you did not request this, you can safely ignore this email.</p>
      </div>`;
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: email,
          subject,
          html,
          smtpSettings: { ...smtpSettings, fromName: smtpSettings.fromName || storeName },
        }),
      });
      if (!res.ok) {
        const errTxt = await res.text().catch(() => '');
        console.error('[CHECKOUT OTP] send-email failed', res.status, errTxt);
        console.log(`[CHECKOUT OTP DEV] Code for ${email}: ${code}`);
        return { success: false, message: `Could not send code (server ${res.status}). Please try again.` };
      }
    } catch (e) {
      console.error('[CHECKOUT OTP] network error', e);
      console.log(`[CHECKOUT OTP DEV] Code for ${email}: ${code}`);
      return { success: false, message: 'Could not reach email server. Please try again.' };
    }
    return { success: true, message: `Verification code sent to ${email}. Check your inbox.` };
  };

  const verifyCheckoutEmailOtp = (email: string, otp: string): { success: boolean; message: string } => {
    const key = (email || '').trim().toLowerCase();
    const entry = getCheckoutOtpStore()[key];
    if (!entry) return { success: false, message: 'No code found. Please request a new one.' };
    if (Date.now() > entry.expiresAt) { deleteCheckoutOtpEntry(key); return { success: false, message: 'Code expired. Request a new one.' }; }
    if (entry.code !== (otp || '').trim()) return { success: false, message: 'Incorrect code. Try again.' };
    deleteCheckoutOtpEntry(key);
    // Also flip the EV-store entry so the existing "Block Checkout Until Verified"
    // gate (isEmailVerified) recognises this email as verified.
    try {
      const evStore = getEvStore();
      evStore[key] = { token: 'checkout-otp', expiresAt: Date.now() + 365 * 24 * 3600_000, verified: true };
      localStorage.setItem(EV_KEY, JSON.stringify(evStore));
    } catch {}
    return { success: true, message: 'Email verified!' };
  };

  // ── Registration OTP ─────────────────────────────────────────────────────────
  // Sends a 6-digit OTP to verify email at signup time — same pipeline as checkout OTP.
  const REG_OTP_KEY = 'qf_reg_otp_store';
  const getRegOtpStore = (): Record<string, { code: string; expiresAt: number }> => {
    try { return JSON.parse(localStorage.getItem(REG_OTP_KEY) || '{}'); } catch { return {}; }
  };

  const sendRegistrationOtp = async (email: string, name: string): Promise<{ success: boolean; message: string }> => {
    const key = (email || '').trim().toLowerCase();
    if (!key || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) {
      return { success: false, message: 'Please enter a valid email address.' };
    }
    // ✅ 1-email-1-account: check BEFORE sending OTP so we don't waste emails
    // and so users get a clear error immediately rather than after entering the code
    const existingProfiles = getUserProfiles();
    if (existingProfiles[key]) {
      return { success: false, message: 'An account already exists with this email. Please log in instead.' };
    }
    try {
      const backendUser = await getUserByEmailAccount(key);
      if (backendUser) {
        return { success: false, message: 'An account already exists with this email. Please log in instead.' };
      }
    } catch { /* non-fatal — registerUser will catch duplicates again */ }
    if (!smtpSettings?.host || !smtpSettings?.email) {
      return { success: false, message: 'Email service is not configured. Contact the store admin.' };
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiryMinutes = 10;
    const store = getRegOtpStore();
    store[key] = { code, expiresAt: Date.now() + expiryMinutes * 60_000 };
    try { localStorage.setItem(REG_OTP_KEY, JSON.stringify(store)); } catch {}

    const storeName = siteSettings?.websiteName || 'E-Shop';
    const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#f8fafc;border-radius:12px;">
      <div style="text-align:center;margin-bottom:16px;font-size:40px;">🎉</div>
      <h2 style="color:#0f172a;margin:0 0 8px;text-align:center;">Verify your email</h2>
      <p style="color:#475569;font-size:14px;text-align:center;">Hi <strong>${name || 'there'}</strong>, use the code below to complete your ${storeName} account signup.</p>
      <div style="background:#fff;border:2px dashed #10b981;border-radius:10px;padding:18px;margin:18px 0;text-align:center;font-size:30px;letter-spacing:8px;font-weight:800;color:#065f46;">${code}</div>
      <p style="color:#64748b;font-size:12px;text-align:center;">This code expires in ${expiryMinutes} minutes. If you didn't try to sign up, you can ignore this email.</p>
    </div>`;
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: email,
          subject: `Your ${storeName} signup verification code`,
          html,
          smtpSettings: { ...smtpSettings, fromName: smtpSettings.fromName || storeName },
        }),
      });
      if (!res.ok) {
        console.error('[REG OTP] send-email failed', res.status);
        console.log(`[REG OTP DEV] Code for ${email}: ${code}`);
        return { success: false, message: `Could not send code (server ${res.status}). Please try again.` };
      }
    } catch (e) {
      console.error('[REG OTP] network error', e);
      console.log(`[REG OTP DEV] Code for ${email}: ${code}`);
      return { success: false, message: 'Could not reach email server. Please try again.' };
    }
    return { success: true, message: `Verification code sent to ${email}. Check your inbox.` };
  };

  const verifyRegistrationOtp = (email: string, otp: string): { success: boolean; message: string } => {
    const key = (email || '').trim().toLowerCase();
    const store = getRegOtpStore();
    const entry = store[key];
    if (!entry) return { success: false, message: 'No code found for this email. Request a new one.' };
    if (Date.now() > entry.expiresAt) {
      delete store[key];
      try { localStorage.setItem(REG_OTP_KEY, JSON.stringify(store)); } catch {}
      return { success: false, message: 'Code expired. Request a new one.' };
    }
    if (entry.code !== (otp || '').trim()) return { success: false, message: 'Incorrect code. Try again.' };
    delete store[key];
    try { localStorage.setItem(REG_OTP_KEY, JSON.stringify(store)); } catch {}
    // Mark email as verified in EV store
    try {
      const evStore = getEvStore();
      evStore[key] = { token: 'reg-otp', expiresAt: Date.now() + 365 * 24 * 3600_000, verified: true };
      localStorage.setItem(EV_KEY, JSON.stringify(evStore));
    } catch {}
    return { success: true, message: 'Email verified! Creating your account...' };
  };

  // ── ensureUserAfterCheckout ───────────────────────────────────────────────
  // After a successful order, make sure a user account exists for this email.
  // If not, create one with an empty password hash and email an OTP the user
  // can use through the "Forgot password" flow to set a password. Either way,
  // log the customer in on the device.
  const ensureUserAfterCheckout = async (data: {
    email: string; name: string; phone: string;
    address: string; city: string; postalCode?: string; orderId?: string;
  }): Promise<{ created: boolean; passwordSetupSent: boolean }> => {
    const key = (data.email || '').trim().toLowerCase();
    if (!key) return { created: false, passwordSetupSent: false };
    const sendPasswordSetupEmail = async (profile: UserProfile): Promise<boolean> => {
      try {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiryMinutes = smtpSettings?.otpExpiryMinutes || 30;
        setOtpEntry(key, { code, expiresAt: Date.now() + expiryMinutes * 60_000 });
        const storeName = siteSettings?.websiteName || 'E-Shop';
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: profile.email,
            subject: `Set your ${storeName} account password`,
            html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;background:#f8fafc;border-radius:12px;">
              <h2 style="color:#0f172a;margin:0 0 12px;">Welcome to ${storeName}, ${profile.name}!</h2>
              <p style="color:#475569;font-size:14px;">We created an account for you so you can track your orders. To finish setting up, choose a password using the one-time code below.</p>
              <p style="color:#475569;font-size:14px;margin:8px 0 0;">On the site, open <strong>Sign in → Forgot password</strong>, enter this email, then paste the code:</p>
              <div style="background:#fff;border:2px dashed #6366f1;border-radius:10px;padding:18px;margin:18px 0;text-align:center;font-size:30px;letter-spacing:8px;font-weight:800;color:#3730a3;">${code}</div>
              <p style="color:#64748b;font-size:12px;">This code expires in ${expiryMinutes} minutes. You are already logged in on the device where you placed the order.</p>
            </div>`,
            smtpSettings: smtpSettings ? { ...smtpSettings, fromName: smtpSettings.fromName || storeName } : null,
          }),
        });
        return true;
      } catch (err) {
        console.warn('Password-setup email failed (non-blocking):', err);
        return false;
      }
    };
    const profiles = getUserProfiles();
    // Check both localStorage and the backend DB so we never create a
    // duplicate account when the original was registered via Firebase/Supabase
    // on a different device or cleared localStorage.
    const localExisting = profiles[key] || null;
    const backendExisting = localExisting ? null : await getUserByEmailAccount(key).catch(() => null);
    const existing = localExisting || backendExisting;
    if (existing) {
      // Backfill profile fields the customer just supplied at checkout but
      // that were missing on the account (most commonly: phone, address,
      // city). This is what makes the "My Account" modal show their phone
      // without forcing them to retype it. We deliberately DO NOT take over
      // the phone index (phoneKey) here — the phone is purely a profile
      // attribute, so a future signup with that number is still possible.
      const patched: UserProfile = {
        ...existing,
        phone: existing.phone || data.phone || '',
        address: existing.address || data.address || '',
        city: existing.city || data.city || '',
        orderIds: data.orderId && !(existing.orderIds || []).includes(data.orderId)
          ? [...(existing.orderIds || []), data.orderId]
          : existing.orderIds || [],
      };
      const changed =
        patched.phone !== existing.phone ||
        patched.address !== existing.address ||
        patched.city !== existing.city ||
        (patched.orderIds || []).length !== (existing.orderIds || []).length;
      if (changed) {
        try {
          await saveUserAccount(patched, { createPhoneIndex: false });
        } catch (e) {
          console.warn('[ensureUserAfterCheckout] profile backfill failed:', e);
        }
      }
      setCurrentUserSession(patched.email);
      setUserProfileState(patched);
      setCurrentUserEmail(patched.email);
      const lastSetupSentAt = patched.passwordSetupSentAt ? Date.parse(patched.passwordSetupSentAt) : 0;
      const shouldSendSetup = !patched.passwordHash && (!lastSetupSentAt || Date.now() - lastSetupSentAt > 15 * 60_000);
      const passwordSetupSent = shouldSendSetup ? await sendPasswordSetupEmail(patched) : false;
      if (passwordSetupSent) {
        const updated = { ...patched, passwordSetupSentAt: new Date().toISOString() };
        await saveUserAccount(updated, { createPhoneIndex: false });
        saveUserProfile(updated);
        setUserProfileState(updated);
      }
      return { created: false, passwordSetupSent };
    }
    const newProfile: UserProfile = {
      // Derived from the email (not a random timestamp) so two near-
      // simultaneous checkouts/auto-account-creates for the same address
      // (double-submit, slow-network retry, two tabs, etc.) always collapse
      // onto the same account record instead of creating two — see
      // emailToUserId() in db.ts.
      id: await emailToUserId(key),
      name: data.name,
      email: key,
      // Save the phone on the account profile so the user sees it in their
      // "My Account" panel and doesn't have to re-enter it on every order.
      // We intentionally keep phoneKey empty so this phone is NOT registered
      // as a unique login index — the real owner of that number can still
      // sign up separately and claim phone-based login later.
      phone: data.phone || '',
      phoneKey: '',
      address: data.address || '',
      city: data.city || '',
      passwordHash: '', // null/empty password — user will set one via OTP link
      orderIds: data.orderId ? [data.orderId] : [],
    };
    await saveUserAccount(newProfile, { createPhoneIndex: false });
    setCurrentUserSession(newProfile.email);
    setUserProfileState(newProfile);
    setCurrentUserEmail(newProfile.email);

    // Send a "set your password" email. We reuse the existing OTP store so the
    // user can drop the code into the standard "Forgot password" flow.
    const passwordSetupSent = await sendPasswordSetupEmail(newProfile);
    if (passwordSetupSent) {
      const updated = { ...newProfile, passwordSetupSentAt: new Date().toISOString() };
      await saveUserAccount(updated, { createPhoneIndex: false });
      saveUserProfile(updated);
      setUserProfileState(updated);
    }
    return { created: true, passwordSetupSent };
  };



  // ── SMS OTP (unchanged) ─────────────────────────────────────────────────────
  const SMS_OTP_KEY = 'qf_sms_otp_store';
  const getSmsOtpStore = (): Record<string, { code: string; expiresAt: number; attempts: number }> => {
    try { return JSON.parse(localStorage.getItem(SMS_OTP_KEY) || '{}'); } catch { return {}; }
  };

  const sendSmsOtp = async (phone: string, email: string): Promise<{ success: boolean; message: string }> => {
    const smsCfg = smsSettings;
    if (!smsCfg?.isEnabled) return { success: false, message: 'SMS gateway is not configured.' };
    if (!smsCfg.otpEnabled) return { success: false, message: 'SMS OTP is disabled.' };
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiryMinutes = smsCfg.otpExpiryMinutes || 10;
    const smsStore = getSmsOtpStore();
    const phoneKey = phone.replace(/\s/g, '');
    smsStore[phoneKey] = { code, expiresAt: Date.now() + expiryMinutes * 60_000, attempts: 0 };
    localStorage.setItem(SMS_OTP_KEY, JSON.stringify(smsStore));
    const storeName = siteSettings?.websiteName || 'E-Shop';
    const message = (smsCfg.otpMessageTemplate || '{{code}} is your {{store}} code. Valid for {{expiry}} min.')
      .replace('{{code}}', code).replace('{{store}}', storeName).replace('{{expiry}}', String(expiryMinutes));
    try {
      const res = await fetch('/api/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phoneKey, message, twilioSettings: smsCfg }),
      });
      const data = await res.json();
      if (data.success) { if (data.simulated) console.log(`[SMS OTP DEV] Code for ${phoneKey}: ${code}`); return { success: true, message: `OTP sent to ${phoneKey}.` }; }
      if (res.status === 429) return { success: false, message: 'Too many requests. Please wait.' };
      return { success: false, message: data.error || 'SMS delivery failed.' };
    } catch { return { success: false, message: 'SMS service unavailable.' }; }
  };

  const verifySmsOtp = (phone: string, otp: string): { success: boolean; message: string } => {
    const smsStore = getSmsOtpStore();
    const phoneKey = phone.replace(/\s/g, '');
    const entry = smsStore[phoneKey];
    if (!entry) return { success: false, message: 'No OTP found. Request a new one.' };
    if (Date.now() > entry.expiresAt) { delete smsStore[phoneKey]; localStorage.setItem(SMS_OTP_KEY, JSON.stringify(smsStore)); return { success: false, message: 'OTP expired.' }; }
    if (entry.attempts >= 5) return { success: false, message: 'Too many attempts. Request a new OTP.' };
    if (entry.code !== otp.trim()) { entry.attempts++; localStorage.setItem(SMS_OTP_KEY, JSON.stringify(smsStore)); return { success: false, message: `Incorrect OTP. ${5 - entry.attempts} attempts remaining.` }; }
    delete smsStore[phoneKey];
    localStorage.setItem(SMS_OTP_KEY, JSON.stringify(smsStore));
    return { success: true, message: 'OTP verified!' };
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  PRODUCT / CATEGORY / ORDER ACTIONS (engine-agnostic via dbService)
  // ─────────────────────────────────────────────────────────────────────────

  const addProduct = async (product: Product) => {
    await dbService.saveProduct(product);
    setProducts(prev => [...prev.filter(p => p.id !== product.id), product]);
  };

  const editProduct = async (product: Product) => {
    await dbService.saveProduct(product);
    setProducts(prev => prev.map(p => p.id === product.id ? product : p));
  };

  const deleteProduct = async (productId: string) => {
    await dbService.deleteProduct(productId);
    setProducts(prev => prev.filter(p => p.id !== productId));
  };

  const updateProductStock = async (productId: string, newStock: number) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    const updated = { ...product, stock: newStock };
    await dbService.saveProduct(updated);
    setProducts(prev => prev.map(p => p.id === productId ? updated : p));
  };

  const addCategory = async (category: Category) => {
    await dbService.saveCategory(category);
    setCategories(prev => [...prev.filter(c => c.id !== category.id), category]);
  };

  const editCategory = async (category: Category) => {
    await dbService.saveCategory(category);
    setCategories(prev => prev.map(c => c.id === category.id ? category : c));
  };

  const deleteCategory = async (categoryId: string) => {
    await dbService.deleteCategory(categoryId);
    setCategories(prev => prev.filter(c => c.id !== categoryId));
  };

  const placeOrder = async (
    orderData: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'orderStatus' | 'paymentStatus'> & {
      paymentStatus?: Order['paymentStatus'];
      orderStatus?: Order['orderStatus'];
    },
  ): Promise<Order> => {
    const normalizedOrderEmail = (orderData.email || '').trim().toLowerCase();
    const customerUserId = normalizedOrderEmail ? await emailToUserId(normalizedOrderEmail) : undefined;
    const newOrder: Order = {
      ...orderData,
      ...(customerUserId ? { userId: customerUserId, email: normalizedOrderEmail } : {}),
      id: 'ord_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      orderNumber: 'QF-' + Math.floor(10000 + Math.random() * 90000),
      createdAt: new Date().toISOString(),
      // Auto-verified payments (Stripe, PayPal, bKash Auto, etc.) pass
      // orderStatus: 'Confirmed'. Manual/COD orders default to 'Pending'.
      orderStatus: orderData.orderStatus ?? 'Pending',
      paymentStatus: orderData.paymentStatus ?? 'Pending',
    };
    await dbService.saveOrder(newOrder);
    setOrders(prev => [newOrder, ...prev]);
    // Deduct stock for each item
    for (const item of newOrder.items) {
      const product = products.find(p => p.id === item.productId);
      if (product) {
        const updated = { ...product, stock: Math.max(0, product.stock - item.quantity) };
        await dbService.saveProduct(updated);
        setProducts(prev => prev.map(p => p.id === updated.id ? updated : p));
      }
    }

    // ── Send order confirmation email to customer ────────────────────────
    try {
      const storeName = (siteSettings?.websiteName || 'Store').trim();

      // Currency formatter that respects the admin's currency symbol /
      // position so emails never fall back to a hardcoded "$".
      const _sym = siteSettings?.currencySymbol || '$';
      const _pos = (siteSettings?.currencyPosition || 'before') as 'before' | 'after';
      const fmtMoney = (n: number) =>
        _pos === 'after' ? `${n.toFixed(2)}${_sym}` : `${_sym}${n.toFixed(2)}`;

      // Generate the invoice as a PDF on the client so the customer receives
      // it as a proper attachment, not just an inline HTML email.
      let invoicePdfBase64: string | null = null;
      try {
        invoicePdfBase64 = buildInvoicePdfBase64({ order: newOrder, siteSettings });
      } catch (pdfErr) {
        // PDF generation must never block the email; log and continue.
        console.warn('[INVOICE PDF] generation failed, sending email without attachment:', pdfErr);
      }

      const itemsHtml = newOrder.items.map(i => {
        const variantText =
          (i as any).variantLabel ||
          ((i as any).selectedVariants
            ? Object.entries((i as any).selectedVariants as Record<string, string>)
                .map(([g, v]) => `${g}: ${v}`)
                .join(' / ')
            : '');
        const variantLine = variantText
          ? `<div style="font-size:11px;color:#64748b;font-style:italic;margin-top:2px;">${variantText}</div>`
          : '';
        return `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#1e293b;">${i.name}${variantLine}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;text-align:center;">${i.quantity}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#475569;text-align:right;">${fmtMoney(i.price)}</td></tr>`;
      }).join('');

      // Partial-COD breakdown — only rendered when the order was placed
      // through a delivery-zone that required prepayment. Customers see
      // exactly how much they already paid online and how much is still due
      // on delivery.
      const partialCodHtml =
        (newOrder.paidAmount && newOrder.paidAmount > 0 && (newOrder.outstandingAmount ?? 0) > 0)
          ? `<div style="margin-top:16px;padding:14px;background:#fff7ed;border:1px solid #fdba74;border-radius:10px;font-size:13px;color:#9a3412;">
              <p style="margin:0 0 4px;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:0.05em;">Partial COD</p>
              <p style="margin:2px 0;">Paid online (advance): <strong>${fmtMoney(newOrder.paidAmount)}</strong></p>
              <p style="margin:2px 0;">Due on delivery: <strong>${fmtMoney(newOrder.outstandingAmount ?? 0)}</strong></p>
             </div>`
          : '';

      const confirmationHtml = (
        smtpSettings?.orderConfirmationTemplate ||
        `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;background:#f8fafc;border-radius:12px;">
          <div style="text-align:center;margin-bottom:24px;">
            <h1 style="color:#0f172a;margin:0;font-size:24px;">${storeName}</h1>
            <p style="color:#64748b;font-size:14px;margin:4px 0 0;">Order Confirmed!</p>
          </div>
          <div style="background:#fff;border:2px solid #e2e8f0;border-radius:10px;padding:20px;margin-bottom:20px;">
            <p style="color:#64748b;font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.05em;">Order #{{orderNumber}}</p>
            <p style="color:#1e293b;font-size:14px;margin:0;">Hi <strong>{{customerName}}</strong>, your order is confirmed!</p>
          </div>
          <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:2px solid #e2e8f0;">
            <thead><tr style="background:#0f172a;color:#fff;"><th style="padding:10px 12px;text-align:left;font-size:12px;text-transform:uppercase;">Item</th><th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;">Qty</th><th style="padding:10px 12px;text-align:right;font-size:12px;text-transform:uppercase;">Price</th></tr></thead>
            <tbody>{{items}}</tbody>
          </table>
          <div style="margin-top:16px;text-align:right;font-size:14px;">
            <p style="color:#64748b;margin:4px 0;">Subtotal: <strong>{{subtotal}}</strong></p>
            <p style="color:#64748b;margin:4px 0;">Delivery: <strong>{{deliveryFee}}</strong></p>
            <p style="color:#059669;font-size:18px;font-weight:900;margin:8px 0 0;">Total: <strong>{{total}}</strong></p>
          </div>
          ${partialCodHtml}
          <div style="margin-top:24px;padding:16px;background:#f1f5f9;border-radius:8px;font-size:13px;color:#475569;">
            <p style="margin:0 0 4px;"><strong>Deliver to:</strong> ${newOrder.address}, ${newOrder.city}</p>
            <p style="margin:0;"><strong>Payment:</strong> ${newOrder.paymentMethod}</p>
          </div>
          <p style="text-align:center;color:#94a3b8;font-size:11px;margin-top:24px;">Thank you for shopping at ${storeName}!</p>
        </div>`
      )
        .replace(/\{\{orderNumber\}\}/g, newOrder.orderNumber)
        .replace(/\{\{customerName\}\}/g, newOrder.customerName)
        .replace(/\{\{items\}\}/g, itemsHtml)
        .replace(/\{\{subtotal\}\}/g, fmtMoney(newOrder.subtotal))
        .replace(/\{\{deliveryFee\}\}/g, fmtMoney(newOrder.deliveryFee))
        .replace(/\{\{total\}\}/g, fmtMoney(newOrder.total))
        .replace(/\{\{currency\}\}/g, siteSettings?.currency || '')
        .replace(/\{\{currencySymbol\}\}/g, _sym);

      const orderSubject = smtpSettings?.orderConfirmationSubject || `[${storeName}] Order #${newOrder.orderNumber} Confirmed!`;

      // Send to customer — with PDF invoice attached when available.
      fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: newOrder.email,
          subject: orderSubject,
          html: confirmationHtml,
          smtpSettings: smtpSettings ? { ...smtpSettings, fromName: smtpSettings.fromName || storeName } : null,
          attachments: invoicePdfBase64
            ? [
                {
                  filename: `invoice-${newOrder.orderNumber}.pdf`,
                  content: invoicePdfBase64,
                  contentType: 'application/pdf',
                },
              ]
            : undefined,
        }),
      }).catch(() => {});

      // Send admin notification
      const adminEmail = smtpSettings?.email;
      if (adminEmail) {
        const adminSubject = smtpSettings?.adminOrderNotificationSubject || `[${storeName}] New Order #${newOrder.orderNumber} — ${newOrder.customerName}`;
        const adminHtml = (
          smtpSettings?.adminOrderNotificationTemplate ||
          `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;background:#f8fafc;border-radius:12px;">
            <h2 style="color:#0f172a;margin:0;"> New Order Received</h2>
            <p style="color:#64748b;font-size:14px;">Order #<strong>${newOrder.orderNumber}</strong> from <strong>${newOrder.customerName}</strong></p>
            <div style="background:#fff;border:2px solid #e2e8f0;border-radius:10px;padding:16px;margin:16px 0;">
              <p style="color:#475569;margin:4px 0;"><strong>Customer:</strong> ${newOrder.customerName}</p>
              <p style="color:#475569;margin:4px 0;"><strong>Email:</strong> ${newOrder.email}</p>
              <p style="color:#475569;margin:4px 0;"><strong>Phone:</strong> ${newOrder.phone}</p>
              <p style="color:#475569;margin:4px 0;"><strong>Address:</strong> ${newOrder.address}, ${newOrder.city}</p>
              <p style="color:#475569;margin:4px 0;"><strong>Payment:</strong> ${newOrder.paymentMethod}</p>
              <p style="color:#475569;margin:4px 0;"><strong>Total:</strong> ${fmtMoney(newOrder.total)}</p>
            </div>
            <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:2px solid #e2e8f0;">
              <thead><tr style="background:#0f172a;color:#fff;"><th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;">Item</th><th style="padding:8px 12px;text-align:center;font-size:11px;text-transform:uppercase;">Qty</th><th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;">Price</th></tr></thead>
              <tbody>${itemsHtml}</tbody>
            </table>
            <p style="text-align:center;color:#94a3b8;font-size:11px;margin-top:24px;">Manage this order in your Admin Panel.</p>
          </div>`
        );
        fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: adminEmail,
            subject: adminSubject,
            html: adminHtml,
            smtpSettings: smtpSettings ? { ...smtpSettings, fromName: smtpSettings.fromName || storeName } : null,
          }),
        }).catch(() => {});
      }
    } catch { /* email failure is non-blocking */ }

    return newOrder;
  };

  const updateOrderStatus = async (orderId: string, status: Order['orderStatus']) => {
    await dbService.updateOrderStatus(orderId, status);
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      const updated = { ...o, orderStatus: status };
      if (status === 'Delivered') updated.paymentStatus = 'Paid';
      return updated;
    }));

    // ── Send status change email to customer ───────────────────────────────
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order || !order.email) return;
      const storeName = siteSettings?.websiteName || 'Fruitopia';
      const statusEmojis: Record<string, string> = {
        'Pending': '🕐', 'Processing': '👩‍🍳', 'Confirmed': '✅',
        'Shipped': '🚚', 'Delivered': '📦', 'Cancelled': '❌', 'Refunded': '💳',
      };
      const emoji = statusEmojis[status] || '📋';
      const statusHtml = (
        smtpSettings?.orderStatusTemplate ||
        `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;background:#f8fafc;border-radius:12px;">
          <div style="text-align:center;font-size:48px;margin-bottom:12px;">${emoji}</div>
          <h2 style="color:#0f172a;text-align:center;margin:0;">Order Status Updated</h2>
          <p style="color:#64748b;text-align:center;font-size:14px;">Order #<strong>{{orderNumber}}</strong></p>
          <div style="background:#fff;border:2px solid #e2e8f0;border-radius:10px;padding:20px;text-align:center;margin:20px 0;">
            <p style="color:#64748b;font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.05em;">Current Status</p>
            <p style="font-size:28px;font-weight:900;color:#059669;margin:0;">${status}</p>
          </div>
          <p style="color:#475569;font-size:13px;text-align:center;">Hi <strong>{{customerName}}</strong>, your order status has been updated. Check your order tracker for more details.</p>
          <p style="text-align:center;color:#94a3b8;font-size:11px;margin-top:20px;">Thank you for shopping at ${storeName}!</p>
        </div>`
      )
        .replace('{{orderNumber}}', order.orderNumber)
        .replace('{{customerName}}', order.customerName);

      const statusSubject = smtpSettings?.orderStatusSubject || `[${storeName}] Order #${order.orderNumber} — ${emoji} ${status}`;

      fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: order.email,
          subject: statusSubject,
          html: statusHtml,
          smtpSettings: smtpSettings ? { ...smtpSettings, fromName: smtpSettings.fromName || storeName } : null,
        }),
      }).catch(() => {});
    } catch { /* email failure is non-blocking */ }
  };

  const updateOrderPaymentStatus = async (orderId: string, status: Order['paymentStatus']) => {
    await dbService.updateOrderPaymentStatus(orderId, status);
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, paymentStatus: status } : o));
  };

  const deleteOrder = async (orderId: string) => {
    await dbService.deleteOrder(orderId);
    setOrders(prev => prev.filter(o => o.id !== orderId));
  };

  const editOrderNumber = async (orderId: string, newNumber: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const updated = { ...order, orderNumber: newNumber };
    await dbService.saveOrder(updated);
    setOrders(prev => prev.map(o => o.id === orderId ? updated : o));
  };

  const addCoupon    = async (coupon: Coupon)   => { await dbService.saveCoupon(coupon);    setCoupons(prev => [...prev.filter(c => c.id !== coupon.id), coupon]); };
  const deleteCoupon = async (couponId: string) => { await dbService.deleteCoupon(couponId); setCoupons(prev => prev.filter(c => c.id !== couponId)); };

  const subscribeNewsletter = async (email: string) => {
    const success = await dbService.subscribeNewsletter(email);
    if (success) {
      setNewsletterSubscribers(prev => [...prev, { id: 'sub_' + Math.random().toString(36).substr(2, 9), email: email.trim().toLowerCase(), subscribedAt: new Date().toISOString() }]);
      try {
        fetch('/api/send-email', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: email, subject: `Welcome to ${siteSettings?.websiteName || 'our store'} Newsletter!`,
            html: `<div style="font-family:sans-serif;background:#fcf3e3;padding:40px;text-align:center;border-radius:12px;max-width:600px;margin:auto;"><div style="font-size:50px;">🎉</div><h1 style="color:#ff5c35;">Awesome, you are subscribed!</h1><p>Get ready for exciting product launches, healthy organic recipes, and exclusive promo codes directly in your inbox.</p><p style="font-size:13px;color:#9ca3af;">${siteSettings?.trademarkText || ''}</p></div>`,
            smtpSettings: smtpSettings ? { ...smtpSettings, fromName: smtpSettings.fromName || siteSettings?.websiteName || 'Store' } : null,
          }),
        });
      } catch {}
      return { success: true, message: '🎉 Hurray! You registered successfully.' };
    }
    return { success: false, message: 'This email is already subscribed!' };
  };

  const deleteSubscriber = async (id: string) => {
    await dbService.deleteSubscriber(id);
    setNewsletterSubscribers(prev => prev.filter(s => s.id !== id));
  };

  const addReview = async (productId: string, name: string, rating: number, comment: string) => {
    await dbService.addReview(productId, name, rating, comment);
    const [updatedRevs, updatedProds] = await Promise.all([dbService.getReviews(), dbService.getProducts()]);
    setReviews(updatedRevs);
    setProducts(updatedProds);
  };

  const approveReview = async (reviewId: string, approve: boolean) => {
    await dbService.approveReview(reviewId, approve);
    setReviews(prev => prev.map(r => r.id === reviewId ? { ...r, isApproved: approve } : r));
  };

  const deleteReview = async (reviewId: string) => {
    await dbService.deleteReview(reviewId);
    setReviews(prev => prev.filter(r => r.id !== reviewId));
  };

  // ── Settings savers ────────────────────────────────────────────────────────
  const removeUndefinedDeep = (value: any): any => {
    if (Array.isArray(value)) return value.map(removeUndefinedDeep);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, entry]) => entry !== undefined)
          .map(([key, entry]) => [key, removeUndefinedDeep(entry)]),
      );
    }
    return value;
  };

  const saveFirebaseSettingsDoc = async (key: string, value: unknown) => {
    if (databaseEngineRef.current !== 'firebase' && getActiveEngine() !== 'firebase') return;
    const database = getDb();
    if (!database) throw new Error('Firebase database is not ready yet.');
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(database, 'settings', key), removeUndefinedDeep(value), { merge: false });
  };

  const saveSiteSettings = async (settings: SiteSettings) => {
    setSiteSettings(settings);
    try { localStorage.setItem('qf_siteSettings', JSON.stringify(settings)); } catch {}
    await dbService.saveSiteSettings(settings);
    try {
      const bc = new BroadcastChannel('qf_settings_sync');
      bc.postMessage({ type: 'siteSettings', payload: settings });
      bc.close();
    } catch {}
  };

  const saveSMTPSettings = async (s: SMTPSettings) => {
    setSmtpSettings(s);
    try { localStorage.setItem('qf_smtpSettings', JSON.stringify(s)); } catch {}
    await dbService.saveSMTPSettings(s);
    await saveFirebaseSettingsDoc('smtpSettings', s);
  };

  const savePaymentSettings = async (s: PaymentSettings) => {
    setPaymentSettings(s);
    try { localStorage.setItem('qf_paymentSettings', JSON.stringify(s)); } catch {}
    await dbService.savePaymentSettings(s);
    await saveFirebaseSettingsDoc('paymentSettings', s);
    console.log('[AppContext] Payment checkout settings saved to Firebase settings/paymentSettings.');
  };

  const saveAdminSettings = async (s: AdminCredentials) => {
    setAdminSettings(s);
    try { localStorage.setItem('qf_adminSettings', JSON.stringify(s)); } catch {}
    await dbService.saveAdminSettings(s);
    await saveFirebaseSettingsDoc('adminSettings', s);
  };

  const saveSupportSettings = async (s: SupportSettings) => {
    setSupportSettings(s);
    try { localStorage.setItem('qf_supportSettings', JSON.stringify(s)); } catch {}
    await dbService.saveSupportSettings(s);
    await saveFirebaseSettingsDoc('supportSettings', s);
    triggerTawkToLoader();
  };

  const saveSMSSettings = async (s: SMSSettings) => {
    setSMSSettings(s);
    try { localStorage.setItem('qf_smsSettings', JSON.stringify(s)); } catch {}
    await dbService.saveSMSSettings(s);
    await saveFirebaseSettingsDoc('smsSettings', s);
  };

  const saveEmailVerificationSettings = async (s: EmailVerificationSettings) => {
    setEmailVerificationSettings(s);
    try { localStorage.setItem('qf_emailVerification', JSON.stringify(s)); } catch {}
    await dbService.saveEmailVerificationSettings(s);
    await saveFirebaseSettingsDoc('emailVerification', s);
  };

  // ── Cart operations ────────────────────────────────────────────────────────
  const addToCart = (product: Product, selectedVariants?: Record<string, string>, variantPrice?: number) => {
    if (product.stock === 0) return;
    // Unique cart key: productId + variant combo so different variants are separate line items
    const variantKey = selectedVariants && Object.keys(selectedVariants).length > 0
      ? product.id + '_' + Object.entries(selectedVariants).sort().map(([k, v]) => `${k}:${v}`).join('|')
      : product.id;
    setCart(prev => {
      const idx = prev.findIndex(item => item.id === variantKey);
      let updated: CartItem[];
      if (idx > -1) {
        if (prev[idx].quantity >= product.stock) return prev;
        updated = [...prev];
        updated[idx] = { ...updated[idx], quantity: prev[idx].quantity + 1 };
      } else {
        updated = [...prev, { id: variantKey, product, quantity: 1, selectedVariants, variantPrice }];
      }
      try { localStorage.setItem('qf_cart', JSON.stringify(updated)); } catch {}
      return updated;
    });
  };

  const removeFromCart = (itemId: string) => {
    setCart(prev => { const u = prev.filter(i => i.id !== itemId); try { localStorage.setItem('qf_cart', JSON.stringify(u)); } catch {} return u; });
  };

  const updateCartQuantity = (itemId: string, quantity: number) => {
    setCart(prev => {
      const item = prev.find(i => i.id === itemId);
      const maxStock = item
        ? (products.find(p => p.id === item.product.id)?.stock ?? 999)
        : 999;
      const u = quantity <= 0 ? prev.filter(i => i.id !== itemId) : prev.map(i => i.id === itemId ? { ...i, quantity: Math.min(quantity, maxStock) } : i);
      try { localStorage.setItem('qf_cart', JSON.stringify(u)); } catch {} return u;
    });
  };

  const clearCart    = () => { try { localStorage.removeItem('qf_cart'); } catch {} setCart([]); setAppliedCoupon(null); };
  const removeCoupon = () => { setAppliedCoupon(null); };

  const applyCouponCode = (code: string): { success: boolean; message: string } => {
    const match = coupons.find(c => c.code.trim().toUpperCase() === code.trim().toUpperCase());
    if (!match) return { success: false, message: 'Invalid coupon code!' };
    if (match.expiryDate < new Date().toISOString().split('T')[0]) return { success: false, message: 'Coupon has expired!' };
    if (match.usedCount >= match.usageLimit) return { success: false, message: 'Coupon usage limit reached!' };
    setAppliedCoupon(match);
    return { success: true, message: `🎉 Applied ${match.discountPercentage}% Discount!` };
  };

  // ── Delivery Zones ─────────────────────────────────────────────────────────
  const getZoneForCity = (city: string): DeliveryZone => {
    const cl = city.toLowerCase().trim();
    return deliveryZones.find(z => z.isEnabled && z.keywords.some(k => cl.includes(k)))
        || deliveryZones.find(z => z.isEnabled && z.keywords.length === 0)
        || deliveryZones[0];
  };
  const saveDeliveryZonesCtx = async (zones: DeliveryZone[]) => { saveDeliveryZones(zones); setDeliveryZones(zones); };

  // ── Tawk.to Live Chat ──────────────────────────────────────────────────────
  const triggerTawkToLoader = () => {
    const ss = supportSettings;
    if (!ss?.isEnabled || !ss.tawkToId) return;

    // Strip any full URL prefix the admin may have pasted
    const raw = ss.tawkToId.trim()
      .replace(/^https?:\/\/embed\.tawk\.to\//i, '')
      .replace(/^https?:\/\/tawk\.to\//i, '')
      .replace(/\/+$/, '');

    // Tawk.to path MUST be "propertyId/widgetId" — both parts are required.
    // A widgetId looks like "1gwxxxxx" (not just "1").
    // If the admin only entered a propertyId without a widgetId, abort and warn.
    if (!raw.includes('/')) {
      console.warn(
        '[Tawk.to] Invalid ID format. Please enter the full "PropertyID/WidgetID" ' +
        '(e.g. 642abc123/1gwXXXXX) found in Tawk.to Admin → Chat Widget → Direct Chat Link.'
      );
      return;
    }

    const [propertyId, widgetId] = raw.split('/');
    // Sanity-check: widgetId should not be a bare single digit
    if (!propertyId || !widgetId || widgetId.length < 4) {
      console.warn(
        '[Tawk.to] Widget ID looks wrong ("' + widgetId + '"). ' +
        'Copy the full Direct Chat Link from Tawk.to Admin → Chat Widget.'
      );
      return;
    }

    // Clean up any previously injected widget
    document.querySelectorAll('script[src*="embed.tawk.to"]').forEach(n => n.remove());
    document.querySelectorAll('iframe[src*="tawk.to"], [class*="tawk-"], [id*="tawk"]').forEach(n => n.remove());
    document.querySelectorAll('[id^="tawk-"]').forEach(n => n.remove());
    try { delete (window as any).Tawk_API; delete (window as any).Tawk_LoadStart; } catch {}

    (window as any).Tawk_API = (window as any).Tawk_API || {};
    (window as any).Tawk_LoadStart = new Date();

    const s = document.createElement('script');
    s.async = true;
    s.src = `https://embed.tawk.to/${propertyId}/${widgetId}`;
    s.charset = 'UTF-8';
    s.setAttribute('crossorigin', '*');
    s.onerror = () => console.warn(
      '[Tawk.to] Script failed to load. Verify your Property ID and Widget ID ' +
      'in Admin → Support Settings. Format: "propertyId/widgetId".'
    );
    const firstScript = document.getElementsByTagName('script')[0];
    if (firstScript?.parentNode) firstScript.parentNode.insertBefore(s, firstScript);
    else document.head.appendChild(s);
    console.log('[Tawk.to] Loading widget:', `${propertyId}/${widgetId}`);
  };

  // Re-run loader whenever supportSettings changes (avoids stale closure)
  useEffect(() => {
    if (supportSettings?.isEnabled && supportSettings?.tawkToId) {
      triggerTawkToLoader();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportSettings?.isEnabled, supportSettings?.tawkToId]);

  // ── BroadcastChannel / StorageEvent sync ────────────────────────────────────
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('qf_settings_sync');
      bc.onmessage = (e) => {
        if (e.data?.type === 'siteSettings' && e.data?.payload) setSiteSettings(e.data.payload as SiteSettings);
      };
    } catch {}
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'qf_siteSettings' && e.newValue) {
        try { setSiteSettings(JSON.parse(e.newValue) as SiteSettings); } catch {}
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => { bc?.close(); window.removeEventListener('storage', handleStorage); };
  }, []);

  // ── Tab title + favicon + settings persistence ─────────────────────────────
  useEffect(() => {
    if (siteSettings?.siteTitle) document.title = siteSettings.siteTitle;
    else if (siteSettings?.websiteName) document.title = siteSettings.websiteName;
    if (siteSettings?.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = siteSettings.faviconUrl;
    }
    if (siteSettings) { try { localStorage.setItem('qf_siteSettings', JSON.stringify(siteSettings)); } catch {} }
  }, [siteSettings]);

  useEffect(() => { localStorage.setItem('qf_cart', JSON.stringify(cart)); }, [cart]);

  const formatPrice = useCallback((amount: number): string => {
    const sym = resolveCurrencySymbol(siteSettings);
    const pos = siteSettings?.currencyPosition || 'before';
    const formatted = amount.toFixed(2);
    return pos === 'after' ? `${formatted}${sym}` : `${sym}${formatted}`;
  }, [siteSettings?.currencySymbol, siteSettings?.currency, siteSettings?.currencyPosition]);

  // ── reinitializeFirebase — backward-compat wrapper ─────────────────────────
  /**
   * Retained so existing AdminPanel Firebase section code continues to work.
   * Internally it now delegates to `switchDatabaseEngine('firebase', ...)`
   */
  const reinitializeFirebase = useCallback(
    async (config: FirebaseRuntimeConfig): Promise<{ success: boolean; message: string }> => {
      const result = await switchDatabaseEngine('firebase', config);
      // Keep isFirebaseReady in sync
      if (result.success) setIsFirebaseReady(getIsFirebaseConfigured());
      return result;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [switchDatabaseEngine],
  );

  // ─────────────────────────────────────────────────────────────────────────
  //  C1 + C2: ADMIN SESSION WITH FIREBASE AUTH
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * setAdminLoggedIn — **BLOCKING** Firebase Auth sign-in.
   *
   * This function AWAITS Firebase Auth completion before returning, so that
   * any Firestore write that follows immediately is authenticated and
   * succeeds instead of throwing PERMISSION_DENIED.
   *
   * C1 LOGIN: After local credentials pass we sign in to Firebase Auth using
   * a *stable* synthetic password derived from the username only (not the
   * admin password).  This decouples Firebase Auth from the admin password so
   * password changes never break Firestore write access.
   *
   * Sign-in strategy (handles all failure modes):
   *   1. Try signIn with stable password  →  success: done
   *   2. auth/user-not-found              →  create user with stable password
   *   3. auth/wrong-password (migration)  →  sign in with raw password (old
   *      behaviour), then immediately updatePassword to stable password so
   *      future logins use the correct path.
   *   4. Any other error                  →  log a clear warning; local
   *      session is still granted but writes will fail until resolved.
   *
   * C2 LOGOUT: fbSignOut clears the Firebase Auth token server-side before
   * the local session is cleared.
   */
  const setAdminLoggedIn = async (
    loggedIn: boolean,
    username?: string,
    password?: string,
  ): Promise<void> => {
    if (loggedIn) {
      // ── Persist local session ──────────────────────────────────────────
      setIsAdminLoggedIn(true);
      const session = {
        token: Math.random().toString(36).substr(2),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };
      try { localStorage.setItem('qf_admin_session', JSON.stringify(session)); } catch {}

      // ── C1: Firebase Auth sign-in (BLOCKING — AWAITED) ─────────────────
      if (username && password && getIsFirebaseConfigured()) {
        // ✅ FIX: Use the real stored admin email from adminSettings
        // Falls back to synthetic email if not available (backwards compatibility)
        const realAdminEmail = adminSettings?.email?.trim() || (username.trim() + '@fruitopia-admin.internal');

        // Stable password derived from email — never changes when the
        // admin updates their local password, so Firebase Auth stays in sync.
        const stablePassword = 'ftp_' + btoa(realAdminEmail).replace(/[^a-zA-Z0-9]/g, '') + '_auth';

        try {
          // ── Path 1: happy path ─────────────────────────────────────
          await signInAdmin(realAdminEmail, stablePassword);
        } catch (e1: any) {

          if (e1?.code === 'auth/user-not-found' || e1?.code === 'auth/invalid-credential') {
            // ── Path 2: first login ever — create the Firebase Auth user ──
            try {
              await createAdminAccount(realAdminEmail, stablePassword);
            } catch (e2: any) {
              console.warn('[Auth] Firebase Auth user creation failed:', e2?.code ?? e2);
            }

          } else if (e1?.code === 'auth/wrong-password') {
            // ── Path 3: migration — user was created with the raw admin
            //    password (old behaviour). Sign in with that, then
            //    immediately update to the stable password so future
            //    logins take Path 1.  ─────────────────────────────────
            try {
              await signInAdmin(realAdminEmail, password);
              await updateAdminPassword(stablePassword);
            } catch (e3: any) {
              console.warn(
                '[Auth] Firebase Auth migration failed — Firestore writes may be rejected.',
                'code:', e3?.code ?? e3,
              );
            }

          } else {
            // ── Path 4: unexpected error ───────────────────────────────
            console.warn(
              '[Auth] Firebase Auth sign-in failed — Firestore writes will be rejected ' +
              'until this is resolved. Error:', e1?.code ?? e1,
            );
          }
        }

        // ── Verify auth state after all sign-in attempts ─────────────────
        if (auth?.currentUser) {
          console.log(
            '[Auth] ✅ Firebase Auth authenticated as',
            auth.currentUser.email,
            '— Firestore writes will succeed.',
          );
        } else {
          console.warn(
            '[Auth] ❌ auth.currentUser is NULL after sign-in — ' +
            'Firestore writes will fall back to local storage. ' +
            'Check Firebase Console → Authentication → Users to verify the ' +
            `user "${realAdminEmail}" was created.`,
          );
        }
      }
    } else {
      // ── C2: Firebase Auth sign-out via db.ts signOutAdmin ───────────────
      await signOutAdmin();

      // ── Clear local session ────────────────────────────────────────────
      setIsAdminLoggedIn(false);
      try { localStorage.removeItem('qf_admin_session'); } catch {}
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  CONTEXT VALUE
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppContext.Provider
      value={{
        products,
        categories,
        orders,
        coupons,
        newsletterSubscribers,
        reviews,
        siteSettings:              siteSettings || DEFAULT_SITE_SETTINGS,
        smtpSettings:              smtpSettings || DEFAULT_SMTP_SETTINGS,
        paymentSettings:           paymentSettings || DEFAULT_PAYMENT_SETTINGS,
        adminSettings:             adminSettings || DEFAULT_ADMIN_CREDENTIALS,
        supportSettings:           supportSettings || DEFAULT_SUPPORT_SETTINGS,
        smsSettings:               smsSettings || DEFAULT_SMS_SETTINGS,
        emailVerificationSettings: emailVerificationSettings || DEFAULT_EMAIL_VERIFICATION_SETTINGS,
        cart,
        appliedCoupon,
        isAdminLoggedIn,
        isLoading,

        // ── Polymorphic engine API ─────────────────────────────────────────
        databaseEngine,
        switchDatabaseEngine,

        // ── C5: Raw active engine string ──────────────────────────────────
        activeDbEngine: getActiveEngine(),

        addProduct, editProduct, deleteProduct, updateProductStock,
        addCategory, editCategory, deleteCategory,
        placeOrder, updateOrderStatus, updateOrderPaymentStatus, deleteOrder, editOrderNumber,
        // C3: refreshOrders
        refreshOrders,
        addCoupon, deleteCoupon,
        subscribeNewsletter, deleteSubscriber,
        addReview, approveReview, deleteReview,
        saveSiteSettings, saveSMTPSettings, savePaymentSettings, saveAdminSettings,
        saveSupportSettings, saveSMSSettings, saveEmailVerificationSettings,
        sendSmsOtp, verifySmsOtp, sendEmailVerification, verifyEmailToken, isEmailVerified,
        sendCheckoutEmailOtp, verifyCheckoutEmailOtp, ensureUserAfterCheckout,
        sendRegistrationOtp, verifyRegistrationOtp,
        addToCart, removeFromCart, updateCartQuantity, clearCart, applyCouponCode, removeCoupon,
        setAdminLoggedIn,
        triggerTawkToLoader,
        currentUserEmail,
        setCurrentUserEmail,
        formatPrice,
        // C4: isFirebaseReady — driven by useState + dedicated useEffect above
        isFirebaseReady,
        reinitializeFirebase,
        userProfile,
        isUserLoggedIn: !!userProfile,
        loginUser, loginWithGoogle, registerUser, resetUserPassword,
        sendPasswordOtp, verifyPasswordOtp, logoutUser, updateUserProfile, checkPhoneAvailability,
        deliveryZones, getZoneForCity, saveDeliveryZonesCtx,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside an AppProvider context.');
  return context;
};
