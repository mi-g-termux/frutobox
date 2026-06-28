/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Fruitopia — Polymorphic Database Service Layer  (db.ts)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ARCHITECTURE OVERVIEW
 * ─────────────────────
 * This module is the single entry point for ALL data access in Fruitopia.
 * It implements a tri-mode polymorphic backend:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Active Engine Key: localStorage('fruitopia_active_engine') │
 *   │  Values: 'local' | 'firebase' | 'supabase'                  │
 *   └─────────────────────────────────────────────────────────────┘
 *          │                   │                   │
 *     ┌────▼────┐       ┌──────▼──────┐    ┌───────▼───────┐
 *     │  LOCAL  │       │  FIREBASE   │    │   SUPABASE    │
 *     │  MOCK   │       │  FIRESTORE  │    │  POSTGRESQL   │
 *     │(default)│       │  (Google)   │    │  (Supabase)   │
 *     └─────────┘       └─────────────┘    └───────────────┘
 *
 * FALLBACK CHAIN
 * ──────────────
 * If credentials are missing or a backend throws on connect:
 *   supabase → firebase → local (never crashes the app)
 *
 * ENGINE SWITCHING
 * ────────────────
 * `switchActiveDatabaseEngine(engine, credentials)` is the public API for
 * hot-swapping at runtime. It is called by AppContext after the admin
 * clicks "Verify & Save Configuration" in the Cloud Infrastructure panel.
 *
 * SUPABASE TABLE SCHEMA (required if using Supabase)
 * ───────────────────────────────────────────────────
 * All Supabase collections map to a single generic key-value table:
 *
 *   CREATE TABLE settings (
 *     key   TEXT PRIMARY KEY,
 *     value JSONB NOT NULL
 *   );
 *
 *   CREATE TABLE products   (id TEXT PRIMARY KEY, data JSONB NOT NULL);
 *   CREATE TABLE orders     (id TEXT PRIMARY KEY, data JSONB NOT NULL);
 *   CREATE TABLE coupons    (id TEXT PRIMARY KEY, data JSONB NOT NULL);
 *   CREATE TABLE categories (id TEXT PRIMARY KEY, data JSONB NOT NULL);
 *   CREATE TABLE newsletter (id TEXT PRIMARY KEY, data JSONB NOT NULL);
 *   CREATE TABLE reviews    (id TEXT PRIMARY KEY, data JSONB NOT NULL);
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  db as _firebaseDb,
  auth as _firebaseAuth,
  getIsFirebaseConfigured,
  firebaseBootPromise,
} from './firebase';
import {
  getSupabaseClient,
  getIsSupabaseConfigured,
  supabaseBootPromise,
} from './supabase';
import {
  collection,
  getDocs,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
  onSnapshot,
} from 'firebase/firestore';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as _fbSignOut,
  updatePassword,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import type { DatabaseEngine, EngineCredentials } from './types';
import {
  Product,
  Order,
  Coupon,
  NewsletterSubscriber,
  Review,
  SiteSettings,
  SMTPSettings,
  PaymentSettings,
  AdminCredentials,
  SupportSettings,
  Category,
  SMSSettings,
  EmailVerificationSettings,
  DeliveryZone,
} from './types';

// ── Live getters so we always read the current instance after hot-swap ───────
const getDb   = () => _firebaseDb;

/**
 * FIREBASE WRITE-READY CHECK (CRITICAL FIX — GHOST SAVES)
 *
 * Previously: required `!!_firebaseAuth?.currentUser` — this caused ALL
 * Firestore writes to silently skip to localStorage when Firebase Auth
 * wasn't signed in. The admin credentials might be correct in Firestore,
 * but if `setAdminLoggedIn()` → Firebase Auth sign-in failed silently
 * (e.g. email already exists with different password, or network timeout),
 * every `saveProduct`, `saveSiteSettings`, `saveCategory` etc. would NO-OP
 * without any error, creating the illusion of a save ("ghost save").
 *
 * Fix: Remove the auth check from the JS layer. Firestore Security Rules
 * are the correct place to enforce auth — they reject writes with a clear
 * PERMISSION_DENIED error that the try/catch blocks in dbService handle.
 * This way, if Firebase Auth IS signed in (which `setAdminLoggedIn` handles
 * via the synthetic email flow), writes go through. If auth fails, the error
 * is visible to the admin instead of being silently swallowed.
 */
/** Firebase is only allowed when Supabase is NOT the active engine. */
const fbOk    = () => getActiveEngine() !== 'supabase' && getIsFirebaseConfigured() && !!getDb();
const sbOk    = () => getIsSupabaseConfigured() && !!getSupabaseClient();

async function waitForActiveBackendBoot(): Promise<DatabaseEngine> {
  const engine = getActiveEngine();
  if (engine === 'supabase') {
    await supabaseBootPromise;
  } else if (engine === 'firebase') {
    await firebaseBootPromise;
  }
  return getActiveEngine();
}

function requireSupabaseReady(action: string): void {
  if (!sbOk()) {
    throw new Error(`[Supabase] ${action} failed: Supabase is the active backend, but the client is not ready. Check Supabase URL/key and table setup.`);
  }
}

function requireFirebaseReady(action: string): void {
  if (!fbOk()) {
    throw new Error(`[Firebase] ${action} failed: Firebase is the active backend, but Firestore is not ready. Check Firebase config and rules.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ENGINE REGISTRY — localStorage keys
// ─────────────────────────────────────────────────────────────────────────────

/** localStorage key that persists the admin's chosen engine across refreshes */
export const ACTIVE_ENGINE_KEY = 'fruitopia_active_engine';

/**
 * Read the currently persisted engine type.
 * Auto-detects Firebase if credentials exist on disk, even when the
 * engine key hasn't been explicitly set yet (e.g. after Install Wizard).
 */
export function getActiveEngine(): DatabaseEngine {
  try {
    const raw = localStorage.getItem(ACTIVE_ENGINE_KEY) as DatabaseEngine | null;
    if (raw === 'firebase' || raw === 'supabase') return raw;
    // Respect an explicit 'local' choice — only auto-detect when the key
    // is absent/null (never set before, e.g. after Install Wizard).
    if (raw === 'local') return 'local';
    // No engine key set yet — auto-detect from available credentials.
    // Check Supabase first: if Supabase is configured it takes priority,
    // preventing Firebase from accidentally becoming active on a Supabase install.
    if (getIsSupabaseConfigured()) {
      return 'supabase';
    }
    if (getIsFirebaseConfigured()) {
      return 'firebase';
    }
    return 'local';
  } catch {
    return 'local';
  }
}

/**
 * Persist the chosen engine type WITHOUT triggering a connection attempt.
 * The actual connection is handled by AppContext's `switchActiveDatabaseEngine`.
 */
export function setActiveEngine(engine: DatabaseEngine): void {
  try {
    localStorage.setItem(ACTIVE_ENGINE_KEY, engine);
  } catch {
    /* Storage quota exceeded — ignore */
  }
}

// ── Engine-change listeners — AppContext subscribes to get instant updates ──
type EngineChangeCallback = (engine: DatabaseEngine) => void;
const _engineListeners = new Set<EngineChangeCallback>();

export function onEngineChange(cb: EngineChangeCallback): () => void {
  _engineListeners.add(cb);
  return () => _engineListeners.delete(cb);
}

function _notifyEngineChange(engine: DatabaseEngine) {
  _engineListeners.forEach((cb) => cb(engine));
}

// ─────────────────────────────────────────────────────────────────────────────
//  ENGINE SWITCHER — The Core Hot-Swap Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `switchActiveDatabaseEngine` — the primary public API for polymorphic
 * backend switching.
 *
 * Flow:
 *  1. Validate credentials shape for the requested engine.
 *  2. Call the appropriate driver's reinitialize/boot function.
 *  3. On success: persist engine key, fire EngineChange callbacks.
 *  4. On failure: fall back to 'local' mode, never crash.
 *
 * @param engine      - Target engine: 'local' | 'firebase' | 'supabase'
 * @param credentials - Engine-specific credentials (null for 'local')
 * @returns           - { success, message, activeEngine }
 */
export async function switchActiveDatabaseEngine(
  engine: DatabaseEngine,
  credentials: EngineCredentials,
): Promise<{ success: boolean; message: string; activeEngine: DatabaseEngine }> {

  // ── LOCAL mode: always succeeds ──────────────────────────────────────────
  if (engine === 'local') {
    setActiveEngine('local');
    _notifyEngineChange('local');
    return {
      success: true,
      message: 'Switched to Local Mock Mode. Data is stored in this browser only.',
      activeEngine: 'local',
    };
  }

  // ── FIREBASE mode ────────────────────────────────────────────────────────
  if (engine === 'firebase') {
    const creds = credentials as import('./types').FirebaseCredentials | null;
    if (!creds?.apiKey || !creds?.projectId) {
      return {
        success: false,
        message: 'Firebase requires at minimum an API Key and Project ID.',
        activeEngine: getActiveEngine(),
      };
    }
    try {
      const { reinitializeDynamicFirebase } = await import('./firebase');
      const result = await reinitializeDynamicFirebase({
        apiKey:            creds.apiKey,
        authDomain:        creds.authDomain,
        projectId:         creds.projectId,
        storageBucket:     creds.storageBucket,
        messagingSenderId: creds.messagingSenderId,
        appId:             creds.appId,
        databaseId:        creds.databaseId,
      });
      if (result.success) {
        setActiveEngine('firebase');
        _notifyEngineChange('firebase');
        return { success: true, message: result.message, activeEngine: 'firebase' };
      }
      // Firebase rejected — graceful fallback to local
      console.warn('[db] Firebase init rejected, falling back to local.');
      setActiveEngine('local');
      _notifyEngineChange('local');
      return {
        success: false,
        message: result.message + ' — Falling back to Local Mock Mode.',
        activeEngine: 'local',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActiveEngine('local');
      _notifyEngineChange('local');
      return {
        success: false,
        message: `Firebase switch error: ${msg} — Falling back to Local Mock Mode.`,
        activeEngine: 'local',
      };
    }
  }

  // ── SUPABASE mode ────────────────────────────────────────────────────────
  if (engine === 'supabase') {
    const creds = credentials as import('./types').SupabaseCredentials | null;
    if (!creds?.projectUrl || !creds?.anonKey) {
      return {
        success: false,
        message: 'Supabase requires a Project URL and Anon Key.',
        activeEngine: getActiveEngine(),
      };
    }
    try {
      const { reinitializeSupabase } = await import('./supabase');
      const result = await reinitializeSupabase({
        projectUrl: creds.projectUrl,
        anonKey:    creds.anonKey,
      });
      if (result.success) {
        setActiveEngine('supabase');
        _notifyEngineChange('supabase');
        return { success: true, message: result.message, activeEngine: 'supabase' };
      }
      // Supabase rejected — graceful fallback
      console.warn('[db] Supabase init rejected, falling back to local.');
      setActiveEngine('local');
      _notifyEngineChange('local');
      return {
        success: false,
        message: result.message + ' — Falling back to Local Mock Mode.',
        activeEngine: 'local',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActiveEngine('local');
      _notifyEngineChange('local');
      return {
        success: false,
        message: `Supabase switch error: ${msg} — Falling back to Local Mock Mode.`,
        activeEngine: 'local',
      };
    }
  }

  // ── Unknown engine: hard fallback ────────────────────────────────────────
  return {
    success: false,
    message: `Unknown engine "${engine}". Staying on current engine.`,
    activeEngine: getActiveEngine(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  INITIAL POLISHED SEED DATA
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'smoothies',   name: 'Smoothies',      emoji: '🥤', slug: 'smoothies',   isVisible: true },
  { id: 'fresh-juice', name: 'Fresh Juice',     emoji: '🍹', slug: 'fresh-juice', isVisible: true },
  { id: 'snacks',      name: 'Healthy Snacks',  emoji: '🍎', slug: 'snacks',      isVisible: true },
];

export const DEFAULT_PRODUCTS: Product[] = [
  // Smoothies
  { id: 'p1',  name: 'Papaya Smoothie',    description: 'Creamy master blend of fresh ripe papayas, soy milk, and honey.',                           price: 2.30, salePrice: null, stock: 25, image: '🥭', category: 'Smoothies',   ingredients: ['Papaya','Soy Milk','Honey'],              rating: 4.8, reviewsCount: 12, isFeatured: true,  isActive: true },
  { id: 'p2',  name: 'Apple Smoothie',     description: 'Crisp red apples blended with low-fat greek yogurt and cinnamon.',                          price: 2.30, salePrice: null, stock: 8,  image: '🍎', category: 'Smoothies',   ingredients: ['Apple','Greek Yogurt','Cinnamon'],        rating: 4.5, reviewsCount: 6,  isFeatured: true,  isActive: true },
  { id: 'p3',  name: 'Pineapple Smoothie', description: 'Tropical getaway in a glass. Blended pineapple, coconut cream, and banana.',                price: 2.30, salePrice: 1.99,stock: 14, image: '🍍', category: 'Smoothies',   ingredients: ['Pineapple','Coconut Cream','Banana'],     rating: 4.9, reviewsCount: 22, isFeatured: true,  isActive: true },
  { id: 'p4',  name: 'Cherry Smoothie',    description: 'Indulge in rich sweet cherries blended with chia seeds and almond milk.',                   price: 2.30, salePrice: null, stock: 19, image: '🍒', category: 'Smoothies',   ingredients: ['Sweet Cherries','Chia Seeds','Almond Milk'],rating: 4.7,reviewsCount: 15, isFeatured: false, isActive: true },
  { id: 'p5',  name: 'Avocado Smoothie',   description: 'Super food delight! Blended buttery rich avocados, spinach, and direct maple syrup.',       price: 2.30, salePrice: null, stock: 12, image: '🥑', category: 'Smoothies',   ingredients: ['Avocado','Spinach','Maple Syrup'],        rating: 4.6, reviewsCount: 9,  isFeatured: false, isActive: true },
  { id: 'p6',  name: 'Kiwi Smoothie',      description: 'Zesty combination of fresh green kiwi, green grapes, and crushed mint lines.',              price: 2.30, salePrice: null, stock: 5,  image: '🥝', category: 'Smoothies',   ingredients: ['Kiwi','Green Grapes','Mint'],             rating: 4.4, reviewsCount: 7,  isFeatured: false, isActive: true },
  { id: 'p7',  name: 'Banana Smoothie',    description: 'Classic rich fuel. Loaded sweet bananas blended with peanut butter and oat milk.',          price: 2.30, salePrice: null, stock: 32, image: '🍌', category: 'Smoothies',   ingredients: ['Banana','Peanut Butter','Oat Milk'],      rating: 4.9, reviewsCount: 31, isFeatured: true,  isActive: true },
  // Fresh Juice
  { id: 'p8',  name: 'Papaya Fresh Juice', description: 'Cold-pressed standard pure sweet papaya. No sugar added.',                                  price: 2.30, salePrice: null, stock: 15, image: '🍈', category: 'Fresh Juice', ingredients: ['Pure Papaya'],                            rating: 4.7, reviewsCount: 14, isFeatured: true,  isActive: true },
  { id: 'p9',  name: 'Apple Fresh Juice',  description: 'Double cold-pressed organic gala apples. Fresh and crisp.',                                 price: 2.30, salePrice: null, stock: 22, image: '🍎', category: 'Fresh Juice', ingredients: ['Organic Gala Apples'],                   rating: 4.6, reviewsCount: 8,  isFeatured: true,  isActive: true },
  { id: 'p10', name: 'Pineapple Fresh Juice',description: 'Sweet and tangy press. A tropical shot of energy.',                                       price: 2.30, salePrice: 1.99, stock: 3, image: '🍍', category: 'Fresh Juice', ingredients: ['Pure Pineapple'],                        rating: 4.8, reviewsCount: 18, isFeatured: true,  isActive: true },
  { id: 'p11', name: 'Cherry Fresh Juice', description: 'Pure anti-oxidant power. Cherry press with a splash of soda water.',                        price: 2.30, salePrice: null, stock: 17, image: '🍒', category: 'Fresh Juice', ingredients: ['Cherries','Sparkling Water'],             rating: 4.5, reviewsCount: 11, isFeatured: false, isActive: true },
  { id: 'p12', name: 'Avocado Fresh Juice',description: 'Lite dynamic extraction, cold pressed. Extremely creamy and clean.',                        price: 2.30, salePrice: null, stock: 11, image: '🥑', category: 'Fresh Juice', ingredients: ['Avocado','Squeeze of Lime'],              rating: 4.4, reviewsCount: 4,  isFeatured: false, isActive: true },
  { id: 'p13', name: 'Kiwi Fresh Juice',   description: 'Vibrant active kiwi, cold pressed to conserve nutrients.',                                  price: 2.30, salePrice: null, stock: 16, image: '🥝', category: 'Fresh Juice', ingredients: ['Kiwi Juice'],                            rating: 4.7, reviewsCount: 9,  isFeatured: false, isActive: true },
  { id: 'p14', name: 'Banana Fresh Juice', description: 'Smooth extraction of ripe bananas with water and organic agave syrup.',                     price: 2.30, salePrice: null, stock: 24, image: '🍌', category: 'Fresh Juice', ingredients: ['Banana','Agave'],                        rating: 4.5, reviewsCount: 16, isFeatured: true,  isActive: true },
];

export const DEFAULT_COUPONS: Coupon[] = [
  { id: 'c1', code: 'FRUITY20',  discountPercentage: 20, expiryDate: '2028-12-31', usageLimit: 100, usedCount: 5 },
  { id: 'c2', code: 'HEALTHY10', discountPercentage: 10, expiryDate: '2028-12-31', usageLimit: 500, usedCount: 12 },
  { id: 'c3', code: 'FRESH50',   discountPercentage: 50, expiryDate: '2028-06-01', usageLimit: 10,  usedCount: 2 },
];

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  websiteName: 'Fruitopia',
  siteTitle: 'Fruitopia — Fresh Organic Produce & Smoothies',
  logoUrl: '',
  logoEmoji: '',
  faviconUrl: '',
  heroBadge: 'Deliciously Fresh menu!',
  heroTitleLine1: 'Treat yourself',
  heroTitleLine2: 'with something fresh & tasty!',
  heroSubtitle: 'Handcrafted with premium fresh organic ingredients, serving smiles with every vibrant drop.',
  heroButtonText: 'SEE MENU & ORDER',
  heroTimeBadge: 'open from 8 am – 10 pm',
  footerText: 'Fruitopia — fresh, organic, and handcrafted with love.',
  footerLinks: [
    { label: 'Home', url: '/' },
    { label: 'Menu', url: '#menu' },
    { label: 'Reviews', url: '#reviews' },
    { label: 'Newsletter', url: '#newsletter' },
  ],
  contactPhone: '+880 1711-223344',
  contactEmail: 'hello@fruitopia.store',
  contactAddress: '42 Orchard Lane, Gulshan, Dhaka, Bangladesh',
  socialFacebook:  'https://facebook.com/fruitopia',
  socialInstagram: 'https://instagram.com/fruitopia',
  socialTwitter:   'https://twitter.com/fruitopia',
  promoBannerEnabled: true,
  promoBannerText: '🎉 SPECIAL LAUNCH PROMO: Apply code FRUITY20 to get 20% off all orders!',
  themePrimaryColor: '#ff5c35',
  themeBgColor:      '#fcf3e3',
  themeHeaderFont:   'Space Grotesk',
  trademarkText: '© 2026 Fruitopia. All rights reserved.',
  newsletterSectionIcon:  '',
  testimonialSectionIcon: '',
  currency:         'USD',
  currencySymbol:   '$',
  currencyPosition: 'before',
  orderTrackerEnabled:  true,
  orderTrackerInNavbar: false,
  maintenanceMode:    false,
  maintenanceTitle:   '',
  maintenanceMessage: '',
};

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  codEnabled: true,
  bKashEnabled: true, bKashNo: '01711000222', bKashInstructions: 'Pay to our Merchant bKash wallet and submit the Transaction ID.', bKashLogoEmoji: '💸', bKashQrCodeUrl: 'https://images.unsplash.com/photo-1595079676339-1534801ad6cf?w=400',
  nagadEnabled: true, nagadNo: '01911333444', nagadInstructions: 'Send Money to our personal Nagad number and input Transaction ID.', nagadLogoEmoji: '🟠', nagadQrCodeUrl: '',
  rocketEnabled: true, rocketNo: '01511555666_7', rocketInstructions: 'Send Money to our agent Rocket dial *322# and input Txn Ref.', rocketLogoEmoji: '🟣', rocketQrCodeUrl: '',
  bankEnabled: true, bankNo: '102.345.6789.01', bankInstructions: 'Transfer amount directly to our Bank. Specify order reference in transfer description.', bankLogoEmoji: '🏦', bankQrCodeUrl: '', bankName: 'Dhaka Bank Ltd', bankHolder: 'Quirky Fruity Solutions Ltd',
  creditManualEnabled: true, creditManualNo: '4111-2222-3333-4444', creditManualInstructions: 'Submit details of bank memo transfer receipt photo or number.', creditManualLogoEmoji: '💳', creditManualQrCodeUrl: '',
  // ── Automatic gateways: DISABLED by default, NO hard-coded credentials.
  // Admin must enable and supply credentials in CMS → Settings → Checkout Channels.
  paypalEnabled: false, paypalClientId: '', paypalClientSecret: '', paypalSandboxMode: true,
  bKashAutoEnabled: false, nagadAutoEnabled: false,
  stripeEnabled: false, stripePublicKey: '', stripeSecretKey: '', stripeSandboxMode: true,
  sslCommerzEnabled: false, sslCommerzStoreId: '', sslCommerzStorePassword: '', sslCommerzSandboxMode: true,
  razorpayEnabled: false, razorpayKeyId: '', razorpayKeySecret: '', razorpaySandboxMode: true,
  // New gateways
  paytmEnabled: false, paytmMerchantId: '', paytmMerchantKey: '', paytmSandboxMode: true,
  upiManualEnabled: false, upiId: '', upiPayeeName: '', upiQrCodeUrl: '', upiInstructions: 'Pay using any UPI app (GPay, PhonePe, Paytm) and submit the UTR / transaction ID.',
  jazzCashEnabled: false, jazzCashMerchantId: '', jazzCashPassword: '', jazzCashIntegritySalt: '', jazzCashSandboxMode: true,
  easypaisaEnabled: false, easypaisaStoreId: '', easypaisaHashKey: '', easypaisaSandboxMode: true,
  payFastEnabled: false, payFastMerchantId: '', payFastMerchantKey: '', payFastPassphrase: '', payFastSandboxMode: true,
  cardPaymentEnabled: true, shippingFee: 5, taxPercentage: 0.05,
  codBtnColor: '#16a34a', bKashBtnColor: '#e11d48', nagadBtnColor: '#ea580c', rocketBtnColor: '#7c3aed',
  bankBtnColor: '#2563eb', creditManualBtnColor: '#334155', paypalBtnColor: '#1d4ed8', stripeBtnColor: '#4f46e5',
  bKashAutoBtnColor: '#be123c', nagadAutoBtnColor: '#d97706',
};


export const DEFAULT_SMTP_SETTINGS: SMTPSettings = {
  host: 'smtp.gmail.com', port: 587, email: 'notifications@fruitopia.store', password: '', isEnabled: false,
};

export const DEFAULT_ADMIN_CREDENTIALS: AdminCredentials = {
  username: '', email: '', password: '', googleSignInEnabled: false, googleClientId: '',
};

export const DEFAULT_SUPPORT_SETTINGS: SupportSettings = {
  tawkToId: '65cb1234abcd...', isEnabled: false,
};

export const DEFAULT_SMS_SETTINGS: SMSSettings = {
  isEnabled: false, provider: 'twilio', accountSid: '', authToken: '', fromNumber: '',
  otpEnabled: true, otpExpiryMinutes: 10,
  otpMessageTemplate: '{{code}} is your {{store}} verification code. Valid for {{expiry}} min.',
};

export const DEFAULT_DELIVERY_ZONES: DeliveryZone[] = [
  { id: 'dz_dhaka', name: 'Dhaka & Surroundings', keywords: ['dhaka','narayanganj','gazipur','manikganj'], fee: 60,  minDays: 1, maxDays: 2, isEnabled: true },
  { id: 'dz_major', name: 'Major Cities',          keywords: ['chittagong','sylhet','khulna','rajshahi','barishal','comilla','mymensingh'], fee: 100, minDays: 2, maxDays: 3, isEnabled: true },
  { id: 'dz_other', name: 'Rest of Country',       keywords: [], fee: 150, minDays: 4, maxDays: 7, isEnabled: true },
];

export function getDeliveryZones(): DeliveryZone[] {
  try { return JSON.parse(localStorage.getItem('qf_delivery_zones') || 'null') || DEFAULT_DELIVERY_ZONES; }
  catch { return DEFAULT_DELIVERY_ZONES; }
}
export function saveDeliveryZones(zones: DeliveryZone[]): void {
  localStorage.setItem('qf_delivery_zones', JSON.stringify(zones));
}

export const DEFAULT_EMAIL_VERIFICATION_SETTINGS: EmailVerificationSettings = {
  isEnabled: false, requireVerificationBeforeOrder: false, tokenExpiryHours: 24, otpSignInVerification: false,
};

export const DEFAULT_REVIEWS: Review[] = [
  { id: 'r1', productId: 'p1', reviewerName: 'Christian Amon',  rating: 5, comment: 'Hands down the best smoothies in town! The textures are unbelievably rich and the delivery is always super fast. Truly fresh and tasty! ⭐⭐⭐⭐⭐', isApproved: true, createdAt: '2026-05-20T10:15:00Z' },
  { id: 'r2', productId: 'p3', reviewerName: 'Samantha Ray',    rating: 5, comment: 'The Pineapple Smoothie has a perfect balance of tropical sweetness and citrus punch. Highly recommend this store!',                              isApproved: true, createdAt: '2026-05-21T14:22:00Z' },
  { id: 'r3', productId: 'p8', reviewerName: 'David K.',         rating: 4, comment: 'Organic, purely fresh, high quality. No artificial sweetners. Will order again.',                                                                isApproved: true, createdAt: '2026-05-22T08:05:00Z' },
];

// ─────────────────────────────────────────────────────────────────────────────
//  LOCAL STORAGE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getLocal<T>(key: string, defaultValue: T): T {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : defaultValue;
  } catch { return defaultValue; }
}

function setLocal<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn('localStorage write failed:', e); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  IN-MEMORY STORE (hydrated from localStorage on module load)
// ─────────────────────────────────────────────────────────────────────────────

const store = {
  products:      getLocal<Product[]>('qf_products',   DEFAULT_PRODUCTS),
  categories:    getLocal<Category[]>('qf_categories', DEFAULT_CATEGORIES),
  orders:        getLocal<Order[]>('qf_orders',        []),
  coupons:       getLocal<Coupon[]>('qf_coupons',      DEFAULT_COUPONS),
  newsletter:    getLocal<NewsletterSubscriber[]>('qf_newsletter', []),
  reviews:       getLocal<Review[]>('qf_reviews',      DEFAULT_REVIEWS),
  siteSettings:  { ...DEFAULT_SITE_SETTINGS, ...getLocal<Partial<SiteSettings>>('qf_siteSettings', {}) } as SiteSettings,
  smtpSettings:  getLocal<SMTPSettings>('qf_smtpSettings',     DEFAULT_SMTP_SETTINGS),
  paymentSettings: getLocal<PaymentSettings>('qf_paymentSettings', DEFAULT_PAYMENT_SETTINGS),
  adminSettings: getLocal<AdminCredentials>('qf_adminSettings', DEFAULT_ADMIN_CREDENTIALS),
  supportSettings: getLocal<SupportSettings>('qf_supportSettings', DEFAULT_SUPPORT_SETTINGS),
};

// ─────────────────────────────────────────────────────────────────────────────
//  SUPABASE HELPERS — Generic JSONB row read/write
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all rows from a Supabase table.
 * Assumes schema: (id TEXT PRIMARY KEY, data JSONB NOT NULL)
 * Returns array of merged { id, ...data } objects or null on error.
 */
async function sbGetAll<T extends { id: string }>(table: string): Promise<T[] | null> {
  if (!sbOk()) {
    if (getActiveEngine() === 'supabase') requireSupabaseReady(`read ${table}`);
    return null;
  }
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.from(table).select('id, data');
    if (error) {
      const message = `[Supabase] ${table} select failed: ${error.message || 'Unknown error'}${error.code ? ` (${error.code})` : ''}`;
      if (getActiveEngine() === 'supabase') throw new Error(message);
      console.warn(message, error);
      return null;
    }
    return (data || []).map((row: { id: string; data: Record<string, unknown> }) => ({
      id: row.id,
      ...row.data,
    })) as T[];
  } catch (err) {
    if (getActiveEngine() === 'supabase') throw err;
    console.warn(`[Supabase] ${table} getAll threw:`, err);
    return null;
  }
}

/**
 * Upsert a single row into a Supabase table.
 * Schema: (id TEXT PRIMARY KEY, data JSONB NOT NULL)
 */
async function sbUpsert<T extends { id: string }>(table: string, item: T): Promise<void> {
  if (!sbOk()) {
    if (getActiveEngine() === 'supabase') requireSupabaseReady(`save ${table}`);
    return;
  }
  try {
    const sb = getSupabaseClient();
    const { id, ...rest } = item;
    const { error } = await sb.from(table).upsert({ id, data: rest }, { onConflict: 'id' });
    if (error) throw new Error(`[Supabase] ${table} upsert failed: ${error.message || 'Unknown error'}${error.code ? ` (${error.code})` : ''}`);
  } catch (err) {
    console.warn(`[Supabase] ${table} upsert threw:`, err);
    throw err;
  }
}

/**
 * Delete a row from a Supabase table by id.
 */
async function sbDelete(table: string, id: string): Promise<void> {
  if (!sbOk()) {
    if (getActiveEngine() === 'supabase') requireSupabaseReady(`delete from ${table}`);
    return;
  }
  try {
    const sb = getSupabaseClient();
    const { error } = await sb.from(table).delete().eq('id', id);
    if (error) throw new Error(`[Supabase] ${table} delete failed: ${error.message || 'Unknown error'}${error.code ? ` (${error.code})` : ''}`);
  } catch (err) {
    console.warn(`[Supabase] ${table} delete threw:`, err);
    throw err;
  }
}

/**
 * Read a singleton settings record from the `settings` table.
 * Schema: (key TEXT PRIMARY KEY, value JSONB NOT NULL)
 */
async function sbGetSetting<T>(key: string): Promise<T | null> {
  if (!sbOk()) {
    if (getActiveEngine() === 'supabase') requireSupabaseReady(`read settings/${key}`);
    return null;
  }
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
    if (error) {
      const message = `[Supabase] settings "${key}" read failed: ${error.message || 'Unknown error'}${error.code ? ` (${error.code})` : ''}`;
      if (getActiveEngine() === 'supabase') throw new Error(message);
      console.warn(message, error);
      return null;
    }
    if (!data) return null;
    return data.value as T;
  } catch (err) {
    if (getActiveEngine() === 'supabase') throw err;
    return null;
  }
}

/**
 * Write a singleton settings record to the `settings` table.
 */
async function sbSetSetting<T>(key: string, value: T): Promise<void> {
  if (!sbOk()) {
    if (getActiveEngine() === 'supabase') requireSupabaseReady(`save settings/${key}`);
    return;
  }
  const sb = getSupabaseClient();
  const { error } = await sb.from('settings').upsert({ key, value }, { onConflict: 'key' });
  if (error) throw new Error(`[Supabase] settings upsert "${key}" failed: ${error.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  UNIFIED dbService — POLYMORPHIC CRUD API
//  Each method tries: Supabase → Firebase → Local  (in that priority order,
//  based on which engine is currently active and connected)
// ─────────────────────────────────────────────────────────────────────────────

export const dbService = {

  // ── PRODUCTS ───────────────────────────────────────────────────────────────

  async getProducts(): Promise<Product[]> {
    const engine = await waitForActiveBackendBoot();
    // Supabase path
    if (engine === 'supabase') {
      const rows = await sbGetAll<Product>('products');
      if (rows !== null) {
        store.products = rows;
        setLocal('qf_products', store.products);
        return store.products;
      }
    }
    // Firebase path (authenticated)
    if (fbOk()) {
      try {
        const snap = await getDocs(collection(getDb()!, 'products'));
        const list: Product[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Product));
        store.products = list;
        setLocal('qf_products', list);
        return list;
      } catch (err) {
        if (engine === 'firebase') throw err;
        console.warn('[db] Firebase getProducts fallback:', err);
      }
    }
    // Also try Firestore without auth check (permissive rules allow reads without auth)
    // firebaseBootPromise has resolved, so getIsFirebaseConfigured() is accurate
    if (getActiveEngine() !== 'supabase' && getIsFirebaseConfigured() && !!getDb()) {
      try {
        const snap = await getDocs(collection(getDb()!, 'products'));
        const list: Product[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Product));
        if (list.length > 0) {
          store.products = list;
          setLocal('qf_products', list);
          return list;
        }
      } catch { /* silent */ }
    }
    // Local path
    store.products = store.products.filter((p, i, a) => a.findIndex(x => x.id === p.id) === i);
    return store.products;
  },

  async saveProduct(product: Product): Promise<void> {
    // Update local store first (optimistic)
    const idx = store.products.findIndex(p => p.id === product.id);
    if (idx > -1) store.products[idx] = product; else store.products.push(product);
    store.products = store.products.filter((p, i, a) => a.findIndex(x => x.id === p.id) === i);
    setLocal('qf_products', store.products);
    // Persist to active cloud backend
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') { await sbUpsert('products', product); return; }
    if (engine === 'firebase') {
      requireFirebaseReady('save products');
      await setDoc(doc(getDb()!, 'products', product.id), product);
      return;
    }
  },

  async deleteProduct(productId: string): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    // Cloud-first: persist the delete BEFORE updating local state so that if
    // the cloud operation fails the local store is not silently corrupted.
    // Previously local state was updated first, which caused the 'deleted'
    // product to reappear on the next page refresh when Supabase re-fetched
    // its still-existing rows and overwrote the stale localStorage cache.
    if (engine === 'supabase') { await sbDelete('products', productId); }
    else if (engine === 'firebase') {
      requireFirebaseReady('delete products');
      await deleteDoc(doc(getDb()!, 'products', productId));
    }
    store.products = store.products.filter(p => p.id !== productId);
    setLocal('qf_products', store.products);
  },

  // ── CATEGORIES ─────────────────────────────────────────────────────────────

  async getCategories(): Promise<Category[]> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') {
      const rows = await sbGetAll<Category>('categories');
      if (rows !== null) {
        store.categories = rows;
        setLocal('qf_categories', store.categories);
        return store.categories;
      }
    }
    if (fbOk()) {
      try {
        const snap = await getDocs(collection(getDb()!, 'categories'));
        const list: Category[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Category));
        store.categories = list;
        setLocal('qf_categories', list);
        return list;
      } catch (err) {
        if (engine === 'firebase') throw err;
        console.warn('[db] Firebase getCategories fallback:', err);
      }
    }
    // Also try Firestore without auth check (permissive rules allow reads without auth)
    if (getActiveEngine() !== 'supabase' && getIsFirebaseConfigured() && !!getDb()) {
      try {
        const snap = await getDocs(collection(getDb()!, 'categories'));
        const list: Category[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Category));
        if (list.length > 0) {
          store.categories = list;
          setLocal('qf_categories', list);
          return list;
        }
      } catch { /* silent */ }
    }
    store.categories = store.categories.filter((c, i, a) => a.findIndex(x => x.id === c.id) === i);
    return store.categories;
  },

  async saveCategory(category: Category): Promise<void> {
    const idx = store.categories.findIndex(c => c.id === category.id);
    if (idx > -1) store.categories[idx] = category; else store.categories.push(category);
    store.categories = store.categories.filter((c, i, a) => a.findIndex(x => x.id === c.id) === i);
    setLocal('qf_categories', store.categories);
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') { await sbUpsert('categories', category); return; }
    if (engine === 'firebase') {
      requireFirebaseReady('save categories');
      await setDoc(doc(getDb()!, 'categories', category.id), category);
      return;
    }
  },

  async deleteCategory(categoryId: string): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') { await sbDelete('categories', categoryId); }
    else if (engine === 'firebase') {
      requireFirebaseReady('delete categories');
      await deleteDoc(doc(getDb()!, 'categories', categoryId));
    }
    store.categories = store.categories.filter(c => c.id !== categoryId);
    setLocal('qf_categories', store.categories);
  },

  // ── ORDERS ─────────────────────────────────────────────────────────────────

  async getOrders(): Promise<Order[]> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') {
      const rows = await sbGetAll<Order>('orders');
      if (rows !== null) {
        rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        store.orders = rows;
        setLocal('qf_orders', rows);
        return rows;
      }
    }
    if (fbOk()) {
      try {
        const snap = await getDocs(collection(getDb()!, 'orders'));
        const list: Order[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Order));
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        store.orders = list;
        setLocal('qf_orders', list);
        return list;
      } catch (err) {
        if (engine === 'firebase') throw err;
        console.warn('[db] Firebase getOrders fallback:', err);
      }
    }
    return [...store.orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async saveOrder(order: Order): Promise<void> {
    const idx = store.orders.findIndex(o => o.id === order.id);
    if (idx > -1) store.orders[idx] = order; else store.orders.push(order);
    setLocal('qf_orders', store.orders);
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') { await sbUpsert('orders', order); return; }
    if (engine === 'firebase') {
      requireFirebaseReady('save orders');
      await setDoc(doc(getDb()!, 'orders', order.id), order);
      return;
    }
  },

  async updateOrderStatus(orderId: string, status: Order['orderStatus']): Promise<void> {
    const idx = store.orders.findIndex(o => o.id === orderId);
    if (idx > -1) {
      store.orders[idx].orderStatus = status;
      if (status === 'Delivered') store.orders[idx].paymentStatus = 'Paid';
      setLocal('qf_orders', store.orders);
      const engine = await waitForActiveBackendBoot();
      if (engine === 'supabase') { await sbUpsert('orders', store.orders[idx]); return; }
      if (engine === 'firebase') {
        requireFirebaseReady('update order status');
        await setDoc(doc(getDb()!, 'orders', orderId), store.orders[idx]);
        return;
      }
    }
  },

  async updateOrderPaymentStatus(orderId: string, status: Order['paymentStatus']): Promise<void> {
    const idx = store.orders.findIndex(o => o.id === orderId);
    if (idx > -1) {
      store.orders[idx].paymentStatus = status;
      setLocal('qf_orders', store.orders);
      const engine = await waitForActiveBackendBoot();
      if (engine === 'supabase') { await sbUpsert('orders', store.orders[idx]); return; }
      if (engine === 'firebase') {
        requireFirebaseReady('update order payment status');
        await setDoc(doc(getDb()!, 'orders', orderId), store.orders[idx]);
        return;
      }
    }
  },

  async deleteOrder(orderId: string): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') { await sbDelete('orders', orderId); }
    else if (engine === 'firebase') {
      requireFirebaseReady('delete orders');
      await deleteDoc(doc(getDb()!, 'orders', orderId));
    }
    store.orders = store.orders.filter(o => o.id !== orderId);
    setLocal('qf_orders', store.orders);
  },

  // ── COUPONS ────────────────────────────────────────────────────────────────

  async getCoupons(): Promise<Coupon[]> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') {
      const rows = await sbGetAll<Coupon>('coupons');
      if (rows !== null) { store.coupons = rows; setLocal('qf_coupons', rows); return rows; }
    }
    if (fbOk()) {
      try {
        const snap = await getDocs(collection(getDb()!, 'coupons'));
        const list: Coupon[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Coupon));
        store.coupons = list;
        setLocal('qf_coupons', list);
        return list;
      } catch (err) {
        if (engine === 'firebase') throw err;
        console.warn('[db] Firebase getCoupons fallback:', err);
      }
    }
    // Also try Firestore without auth check (permissive rules allow reads without auth)
    if (getActiveEngine() !== 'supabase' && getIsFirebaseConfigured() && !!getDb()) {
      try {
        const snap = await getDocs(collection(getDb()!, 'coupons'));
        const list: Coupon[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Coupon));
        if (list.length > 0) { store.coupons = list; setLocal('qf_coupons', list); return list; }
      } catch { /* silent */ }
    }
    return store.coupons;
  },

  async saveCoupon(coupon: Coupon): Promise<void> {
    const idx = store.coupons.findIndex(c => c.id === coupon.id);
    if (idx > -1) store.coupons[idx] = coupon; else store.coupons.push(coupon);
    setLocal('qf_coupons', store.coupons);
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') { await sbUpsert('coupons', coupon); return; }
    if (engine === 'firebase') {
      requireFirebaseReady('save coupons');
      await setDoc(doc(getDb()!, 'coupons', coupon.id), coupon);
      return;
    }
  },

  async deleteCoupon(couponId: string): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') { await sbDelete('coupons', couponId); }
    else if (engine === 'firebase') {
      requireFirebaseReady('delete coupons');
      await deleteDoc(doc(getDb()!, 'coupons', couponId));
    }
    store.coupons = store.coupons.filter(c => c.id !== couponId);
    setLocal('qf_coupons', store.coupons);
  },

  // ── NEWSLETTER ─────────────────────────────────────────────────────────────

  async getNewsletterSubscribers(): Promise<NewsletterSubscriber[]> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') {
      const rows = await sbGetAll<NewsletterSubscriber>('newsletter');
      if (rows !== null) { store.newsletter = rows; setLocal('qf_newsletter', rows); return rows; }
    }
    if (fbOk()) {
      try {
        const snap = await getDocs(collection(getDb()!, 'newsletter'));
        const list: NewsletterSubscriber[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as NewsletterSubscriber));
        store.newsletter = list;
        setLocal('qf_newsletter', list);
        return list;
      } catch (err) {
        if (engine === 'firebase') throw err;
        console.warn('[db] Firebase getNewsletter fallback:', err);
      }
    }
    return store.newsletter;
  },

  async subscribeNewsletter(email: string): Promise<boolean> {
    const engine = await waitForActiveBackendBoot();
    const cleaned = email.trim().toLowerCase();
    if (!cleaned) return false;
    if (store.newsletter.some(s => s.email.toLowerCase() === cleaned)) return false;
    const sub: NewsletterSubscriber = { id: 'sub_' + Math.random().toString(36).substr(2, 9), email: cleaned, subscribedAt: new Date().toISOString() };
    store.newsletter.push(sub);
    setLocal('qf_newsletter', store.newsletter);
    if (engine === 'supabase') { await sbUpsert('newsletter', sub); return true; }
    if (engine === 'firebase') {
      requireFirebaseReady('save newsletter subscriber');
      await setDoc(doc(getDb()!, 'newsletter', sub.id), sub);
    }
    return true;
  },

  async saveNewsletterSubscriber(subscriber: NewsletterSubscriber): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    const idx = store.newsletter.findIndex(s => s.id === subscriber.id);
    if (idx > -1) store.newsletter[idx] = subscriber; else store.newsletter.push(subscriber);
    setLocal('qf_newsletter', store.newsletter);
    if (engine === 'supabase') { await sbUpsert('newsletter', subscriber); return; }
    if (engine === 'firebase') {
      requireFirebaseReady('save newsletter subscriber');
      await setDoc(doc(getDb()!, 'newsletter', subscriber.id), subscriber);
      return;
    }
  },

  async deleteSubscriber(id: string): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') { await sbDelete('newsletter', id); }
    else if (engine === 'firebase') {
      requireFirebaseReady('delete newsletter subscriber');
      await deleteDoc(doc(getDb()!, 'newsletter', id));
    }
    store.newsletter = store.newsletter.filter(s => s.id !== id);
    setLocal('qf_newsletter', store.newsletter);
  },

  // ── REVIEWS ────────────────────────────────────────────────────────────────

  async getReviews(): Promise<Review[]> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') {
      const rows = await sbGetAll<Review>('reviews');
      if (rows !== null) { store.reviews = rows; setLocal('qf_reviews', rows); return rows; }
    }
    if (fbOk()) {
      try {
        const snap = await getDocs(collection(getDb()!, 'reviews'));
        const list: Review[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Review));
        store.reviews = list;
        setLocal('qf_reviews', list);
        return list;
      } catch (err) {
        if (engine === 'firebase') throw err;
        console.warn('[db] Firebase getReviews fallback:', err);
      }
    }
    // Also try Firestore without auth check (permissive rules allow reads without auth)
    if (getActiveEngine() !== 'supabase' && getIsFirebaseConfigured() && !!getDb()) {
      try {
        const snap = await getDocs(collection(getDb()!, 'reviews'));
        const list: Review[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Review));
        if (list.length > 0) { store.reviews = list; setLocal('qf_reviews', list); return list; }
      } catch { /* silent */ }
    }
    return store.reviews;
  },

  async addReview(productId: string, name: string, rating: number, comment: string): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    const rev: Review = { id: 'rev_' + Math.random().toString(36).substr(2, 9), productId, reviewerName: name || 'Anonymous Guest', rating: rating || 5, comment: comment || '', isApproved: true, createdAt: new Date().toISOString() };
    store.reviews.push(rev);
    setLocal('qf_reviews', store.reviews);
    // Recalculate product rating
    const pIdx = store.products.findIndex(p => p.id === productId);
    if (pIdx > -1) {
      const pRevs = store.reviews.filter(r => r.productId === productId && r.isApproved);
      store.products[pIdx].reviewsCount = pRevs.length;
      store.products[pIdx].rating = Number((pRevs.reduce((s, r) => s + r.rating, 0) / Math.max(1, pRevs.length)).toFixed(1));
      this.saveProduct(store.products[pIdx]);
    }
    if (engine === 'supabase') { await sbUpsert('reviews', rev); return; }
    if (engine === 'firebase') {
      requireFirebaseReady('save reviews');
      await setDoc(doc(getDb()!, 'reviews', rev.id), rev);
      return;
    }
  },

  async saveReview(review: Review): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    const idx = store.reviews.findIndex(r => r.id === review.id);
    if (idx > -1) store.reviews[idx] = review; else store.reviews.push(review);
    setLocal('qf_reviews', store.reviews);
    if (engine === 'supabase') { await sbUpsert('reviews', review); return; }
    if (engine === 'firebase') {
      requireFirebaseReady('save reviews');
      await setDoc(doc(getDb()!, 'reviews', review.id), review);
      return;
    }
  },

  async approveReview(reviewId: string, isApproved: boolean): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    const idx = store.reviews.findIndex(r => r.id === reviewId);
    if (idx > -1) {
      store.reviews[idx].isApproved = isApproved;
      setLocal('qf_reviews', store.reviews);
      if (engine === 'supabase') { await sbUpsert('reviews', store.reviews[idx]); return; }
      if (engine === 'firebase') {
        requireFirebaseReady('update reviews');
        await setDoc(doc(getDb()!, 'reviews', reviewId), store.reviews[idx]);
        return;
      }
    }
  },

  async deleteReview(reviewId: string): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') { await sbDelete('reviews', reviewId); }
    else if (engine === 'firebase') {
      requireFirebaseReady('delete reviews');
      await deleteDoc(doc(getDb()!, 'reviews', reviewId));
    }
    store.reviews = store.reviews.filter(r => r.id !== reviewId);
    setLocal('qf_reviews', store.reviews);
  },

  // ── SITE SETTINGS ──────────────────────────────────────────────────────────

  async getSiteSettings(): Promise<SiteSettings> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') {
      const val = await sbGetSetting<SiteSettings>('siteSettings');
      if (val) { const merged = { ...DEFAULT_SITE_SETTINGS, ...val }; store.siteSettings = merged; setLocal('qf_siteSettings', merged); return merged; }
    }
    if (fbOk()) {
      try {
        const snap = await getDoc(doc(getDb()!, 'settings', 'siteSettings'));
        if (snap.exists()) { const s = { ...DEFAULT_SITE_SETTINGS, ...snap.data() } as SiteSettings; store.siteSettings = s; setLocal('qf_siteSettings', s); return s; }
        await setDoc(doc(getDb()!, 'settings', 'siteSettings'), store.siteSettings);
        return store.siteSettings;
      } catch (err) {
        if (engine === 'firebase') throw err;
        console.warn('[db] Firebase getSiteSettings fallback:', err);
      }
    }
    // Also try Firestore without auth check (permissive rules allow reads without auth)
    if (getActiveEngine() !== 'supabase' && getIsFirebaseConfigured() && !!getDb()) {
      try {
        const snap = await getDoc(doc(getDb()!, 'settings', 'siteSettings'));
        if (snap.exists()) {
          const s = { ...DEFAULT_SITE_SETTINGS, ...snap.data() } as SiteSettings;
          store.siteSettings = s;
          setLocal('qf_siteSettings', s);
          return s;
        }
      } catch { /* silent */ }
    }
    return { ...DEFAULT_SITE_SETTINGS, ...store.siteSettings };
  },

  async saveSiteSettings(settings: SiteSettings): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    const merged = { ...DEFAULT_SITE_SETTINGS, ...settings };
    store.siteSettings = merged;
    setLocal('qf_siteSettings', merged);
    if (engine === 'supabase') { await sbSetSetting('siteSettings', settings); return; }
    if (engine === 'firebase') {
      requireFirebaseReady('save site settings');
      await setDoc(doc(getDb()!, 'settings', 'siteSettings'), settings);
      return;
    }
  },

  // ── SMTP SETTINGS ──────────────────────────────────────────────────────────

  async getSMTPSettings(): Promise<SMTPSettings> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') { const v = await sbGetSetting<SMTPSettings>('smtpSettings'); if (v) { store.smtpSettings = v; setLocal('qf_smtpSettings', v); return v; } }
    if (fbOk()) { try { const snap = await getDoc(doc(getDb()!, 'settings', 'smtpSettings')); if (snap.exists()) { const v = snap.data() as SMTPSettings; store.smtpSettings = v; setLocal('qf_smtpSettings', v); return v; } } catch (err) { if (engine === 'firebase') throw err; console.warn('[db] Firebase getSMTP fallback:', err); } }
    // Also try Firestore without auth check (permissive rules allow reads without auth)
    if (getActiveEngine() !== 'supabase' && getIsFirebaseConfigured() && !!getDb()) {
      try {
        const snap = await getDoc(doc(getDb()!, 'settings', 'smtpSettings'));
        if (snap.exists()) {
          const v = snap.data() as SMTPSettings;
          store.smtpSettings = v;
          setLocal('qf_smtpSettings', v);
          return v;
        }
      } catch { /* silent */ }
    }
    return store.smtpSettings;
  },

  async saveSMTPSettings(settings: SMTPSettings): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    store.smtpSettings = settings;
    setLocal('qf_smtpSettings', settings);
    if (engine === 'supabase') { await sbSetSetting('smtpSettings', settings); return; }
    if (engine === 'firebase') {
      requireFirebaseReady('save SMTP settings');
      await setDoc(doc(getDb()!, 'settings', 'smtpSettings'), settings);
      return;
    }
  },

  // ── PAYMENT SETTINGS ───────────────────────────────────────────────────────

  async getPaymentSettings(): Promise<PaymentSettings> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') { const v = await sbGetSetting<PaymentSettings>('paymentSettings'); if (v) { store.paymentSettings = v; setLocal('qf_paymentSettings', v); return v; } }
    if (fbOk()) { try { const snap = await getDoc(doc(getDb()!, 'settings', 'paymentSettings')); if (snap.exists()) { const v = snap.data() as PaymentSettings; store.paymentSettings = v; setLocal('qf_paymentSettings', v); return v; } } catch (err) { if (engine === 'firebase') throw err; console.warn('[db] Firebase getPayment fallback:', err); } }
    // Also try Firestore without auth check (permissive rules allow reads without auth)
    if (getActiveEngine() !== 'supabase' && getIsFirebaseConfigured() && !!getDb()) {
      try {
        const snap = await getDoc(doc(getDb()!, 'settings', 'paymentSettings'));
        if (snap.exists()) {
          const v = snap.data() as PaymentSettings;
          store.paymentSettings = v;
          setLocal('qf_paymentSettings', v);
          return v;
        }
      } catch { /* silent */ }
    }
    return store.paymentSettings;
  },

  async savePaymentSettings(settings: PaymentSettings): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    store.paymentSettings = settings;
    setLocal('qf_paymentSettings', settings);
    if (engine === 'supabase') { await sbSetSetting('paymentSettings', settings); return; }
    if (engine === 'firebase') {
      requireFirebaseReady('save payment settings');
      await setDoc(doc(getDb()!, 'settings', 'paymentSettings'), settings);
      return;
    }
  },

  // ── ADMIN SETTINGS ─────────────────────────────────────────────────────────

  async getAdminSettings(): Promise<AdminCredentials> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') { const v = await sbGetSetting<AdminCredentials>('adminSettings'); if (v) { store.adminSettings = v; setLocal('qf_adminSettings', v); return v; } }
    if (fbOk()) { try { const snap = await getDoc(doc(getDb()!, 'settings', 'adminSettings')); if (snap.exists()) { const v = snap.data() as AdminCredentials; store.adminSettings = v; setLocal('qf_adminSettings', v); return v; } } catch (err) { if (engine === 'firebase') throw err; console.warn('[db] Firebase getAdmin fallback:', err); } }
    // Also try Firestore without auth check (permissive rules allow reads without auth)
    if (getActiveEngine() !== 'supabase' && getIsFirebaseConfigured() && !!getDb()) {
      try {
        const snap = await getDoc(doc(getDb()!, 'settings', 'adminSettings'));
        if (snap.exists()) {
          const v = snap.data() as AdminCredentials;
          store.adminSettings = v;
          setLocal('qf_adminSettings', v);
          return v;
        }
      } catch (err) {
        // Silent — Firestore may be unavailable or rules may block unauthenticated reads
      }
    }
    return store.adminSettings;
  },

  async saveAdminSettings(settings: AdminCredentials): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    store.adminSettings = settings;
    setLocal('qf_adminSettings', settings);
    if (engine === 'supabase') { await sbSetSetting('adminSettings', settings); return; }
    if (engine === 'firebase') {
      requireFirebaseReady('save admin settings');
      await setDoc(doc(getDb()!, 'settings', 'adminSettings'), settings);
      return;
    }
  },

  // ── SUPPORT SETTINGS ───────────────────────────────────────────────────────

  async getSupportSettings(): Promise<SupportSettings> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') { const v = await sbGetSetting<SupportSettings>('supportSettings'); if (v) { store.supportSettings = v; setLocal('qf_supportSettings', v); return v; } }
    if (fbOk()) { try { const snap = await getDoc(doc(getDb()!, 'settings', 'supportSettings')); if (snap.exists()) { const v = snap.data() as SupportSettings; store.supportSettings = v; setLocal('qf_supportSettings', v); return v; } } catch (err) { if (engine === 'firebase') throw err; console.warn('[db] Firebase getSupport fallback:', err); } }
    // Also try Firestore without auth check (permissive rules allow reads without auth)
    if (getActiveEngine() !== 'supabase' && getIsFirebaseConfigured() && !!getDb()) {
      try {
        const snap = await getDoc(doc(getDb()!, 'settings', 'supportSettings'));
        if (snap.exists()) {
          const v = snap.data() as SupportSettings;
          store.supportSettings = v;
          setLocal('qf_supportSettings', v);
          return v;
        }
      } catch { /* silent */ }
    }
    return store.supportSettings;
  },

  async saveSupportSettings(settings: SupportSettings): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    store.supportSettings = settings;
    setLocal('qf_supportSettings', settings);
    if (engine === 'supabase') { await sbSetSetting('supportSettings', settings); return; }
    if (engine === 'firebase') {
      requireFirebaseReady('save support settings');
      await setDoc(doc(getDb()!, 'settings', 'supportSettings'), settings);
      return;
    }
  },

  // ── SMS SETTINGS ───────────────────────────────────────────────────────────

  async getSMSSettings(): Promise<SMSSettings> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') { const v = await sbGetSetting<SMSSettings>('smsSettings'); if (v) { setLocal('qf_smsSettings', v); return v; } }
    if (fbOk()) { try { const snap = await getDoc(doc(getDb()!, 'settings', 'smsSettings')); if (snap.exists()) { const v = snap.data() as SMSSettings; setLocal('qf_smsSettings', v); return v; } } catch (err) { if (engine === 'firebase') throw err; console.warn('[db] Firebase getSMS fallback:', err); } }
    // Also try Firestore without auth check (permissive rules allow reads without auth)
    if (getActiveEngine() !== 'supabase' && getIsFirebaseConfigured() && !!getDb()) {
      try {
        const snap = await getDoc(doc(getDb()!, 'settings', 'smsSettings'));
        if (snap.exists()) {
          const v = snap.data() as SMSSettings;
          setLocal('qf_smsSettings', v);
          return v;
        }
      } catch { /* silent */ }
    }
    return getLocal<SMSSettings>('qf_smsSettings', DEFAULT_SMS_SETTINGS);
  },

  async saveSMSSettings(settings: SMSSettings): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    setLocal('qf_smsSettings', settings);
    if (engine === 'supabase') { await sbSetSetting('smsSettings', settings); return; }
    if (engine === 'firebase') {
      requireFirebaseReady('save SMS settings');
      await setDoc(doc(getDb()!, 'settings', 'smsSettings'), settings);
      return;
    }
  },

  // ── EMAIL VERIFICATION SETTINGS ────────────────────────────────────────────

  async getEmailVerificationSettings(): Promise<EmailVerificationSettings> {
    const engine = await waitForActiveBackendBoot();
    if (engine === 'supabase') { const v = await sbGetSetting<EmailVerificationSettings>('emailVerification'); if (v) { setLocal('qf_emailVerification', v); return v; } }
    if (fbOk()) { try { const snap = await getDoc(doc(getDb()!, 'settings', 'emailVerification')); if (snap.exists()) { const v = snap.data() as EmailVerificationSettings; setLocal('qf_emailVerification', v); return v; } } catch (err) { if (engine === 'firebase') throw err; console.warn('[db] Firebase getEmailVerif fallback:', err); } }
    // Also try Firestore without auth check (permissive rules allow reads without auth)
    if (getActiveEngine() !== 'supabase' && getIsFirebaseConfigured() && !!getDb()) {
      try {
        const snap = await getDoc(doc(getDb()!, 'settings', 'emailVerification'));
        if (snap.exists()) {
          const v = snap.data() as EmailVerificationSettings;
          setLocal('qf_emailVerification', v);
          return v;
        }
      } catch { /* silent */ }
    }
    return getLocal<EmailVerificationSettings>('qf_emailVerification', DEFAULT_EMAIL_VERIFICATION_SETTINGS);
  },

  async saveEmailVerificationSettings(settings: EmailVerificationSettings): Promise<void> {
    const engine = await waitForActiveBackendBoot();
    setLocal('qf_emailVerification', settings);
    if (engine === 'supabase') { await sbSetSetting('emailVerification', settings); return; }
    if (engine === 'firebase') {
      requireFirebaseReady('save email verification settings');
      await setDoc(doc(getDb()!, 'settings', 'emailVerification'), settings);
      return;
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  USER PROFILES — Firestore-backed, localStorage as fast cache
// ─────────────────────────────────────────────────────────────────────────────

const USER_PROFILES_KEY = 'qf_user_profiles';
const CURRENT_USER_KEY  = 'qf_current_user';

export function getUserProfiles(): Record<string, import('./types').UserProfile> {
  try { const d = localStorage.getItem(USER_PROFILES_KEY); return d ? JSON.parse(d) : {}; }
  catch { return {}; }
}

/** Write a profile to localStorage cache. */
export function saveUserProfile(profile: import('./types').UserProfile): void {
  const profiles = getUserProfiles();
  profiles[profile.email.toLowerCase()] = profile;
  localStorage.setItem(USER_PROFILES_KEY, JSON.stringify(profiles));
}

export function getCurrentUserProfile(): import('./types').UserProfile | null {
  try {
    const email = localStorage.getItem(CURRENT_USER_KEY);
    if (!email) return null;
    return getUserProfiles()[email] || null;
  } catch { return null; }
}

export function setCurrentUserSession(email: string | null): void {
  if (email) { localStorage.setItem(CURRENT_USER_KEY, email.toLowerCase()); }
  else { localStorage.removeItem(CURRENT_USER_KEY); }
}

export function normalizePhoneKey(phone: string): string {
  return (phone || '').replace(/[^\d+]/g, '').replace(/^00/, '+');
}

/**
 * Write a customer UserProfile to Firestore users/{profile.id}.
 * Also updates the localStorage cache.
 * When a phone exists, a userPhones/{phoneKey} index document is created in
 * the same batch so Firestore rules can enforce one account per phone number.
 */
export async function saveUserToFirestore(profile: import('./types').UserProfile, options: { createPhoneIndex?: boolean } = {}): Promise<void> {
  const shouldCreatePhoneIndex = options.createPhoneIndex !== false;
  const normalizedProfile = {
    ...profile,
    email: profile.email.toLowerCase(),
    // Only persist a non-empty phoneKey when we're ALSO creating the
    // matching userPhones/{phoneKey} uniqueness index in this same batch
    // (below). The two must always travel together: a stored phoneKey
    // with no matching index either gets rejected by the Firestore rule,
    // or — if the rule didn't check for it — would let a profile field
    // silently claim a phone number with no real ownership record behind
    // it. Guest-checkout accounts pass `createPhoneIndex: false` on
    // purpose (they're not meant to claim phone uniqueness, so the real
    // owner can still register and claim that number separately later);
    // for those we keep phoneKey empty rather than recomputing it from
    // profile.phone.
    phoneKey: shouldCreatePhoneIndex ? normalizePhoneKey(profile.phone || '') : (profile.phoneKey || ''),
  } as import('./types').UserProfile;

  if (!fbOk()) {
    saveUserProfile(normalizedProfile);
    return;
  }

  try {
    const database = getDb()!;
    const batch = writeBatch(database);
    if (normalizedProfile.phoneKey && shouldCreatePhoneIndex) {
      batch.set(doc(database, 'userPhones', normalizedProfile.phoneKey), {
        phoneKey: normalizedProfile.phoneKey,
        userId: normalizedProfile.id,
        email: normalizedProfile.email,
        createdAt: new Date().toISOString(),
      }, { merge: false });
    }
    batch.set(doc(database, 'users', normalizedProfile.id), normalizedProfile);
    await batch.commit();
    saveUserProfile(normalizedProfile);
  } catch (e) {
    console.warn('[db] saveUserToFirestore failed:', e);
    throw e;
  }
}

/**
 * Read a customer UserProfile from Firestore by document ID.
 * Returns null if not found or Firebase unavailable.
 */
export async function getUserFromFirestore(id: string): Promise<import('./types').UserProfile | null> {
  if (!fbOk()) return null;
  try {
    const snap = await getDoc(doc(getDb()!, 'users', id));
    if (snap.exists()) return snap.data() as import('./types').UserProfile;
    return null;
  } catch (e) {
    console.warn('[db] getUserFromFirestore failed:', e);
    return null;
  }
}

/**
 * Query Firestore users collection by email field.
 * Returns null if not found or Firebase unavailable.
 */
export async function getUserByEmailFromFirestore(email: string): Promise<import('./types').UserProfile | null> {
  if (!fbOk()) return null;
  try {
    const q = query(collection(getDb()!, 'users'), where('email', '==', email.toLowerCase()));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0];
      return { id: d.id, ...d.data() } as import('./types').UserProfile;
    }
    return null;
  } catch (e) {
    console.warn('[db] getUserByEmailFromFirestore failed:', e);
    return null;
  }
}

export async function getUserByPhoneFromFirestore(phone: string): Promise<import('./types').UserProfile | null> {
  const phoneKey = normalizePhoneKey(phone);
  if (!phoneKey || !fbOk()) return null;
  try {
    const q = query(collection(getDb()!, 'users'), where('phoneKey', '==', phoneKey));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0];
      return { id: d.id, ...d.data() } as import('./types').UserProfile;
    }
    return null;
  } catch (e) {
    console.warn('[db] getUserByPhoneFromFirestore failed:', e);
    return null;
  }
}

export async function hashPassword(str: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * DUPLICATE-ACCOUNT PREVENTION — deterministic account ID.
 *
 * Every place that creates a brand-new account (manual signup, guest
 * checkout auto-account, Google sign-in fallback) used to assign the id
 * `Date.now().toString(36)` — a value with no relationship to the email
 * address at all. That meant the ONLY thing stopping two accounts from
 * being created for the same email was a "check if it exists, then write"
 * step in JS. If that check ever raced — a double-tap on "Place Order", a
 * slow network causing a retry, the same email checking out from two tabs,
 * guest-checkout auto-create running again before the first write had
 * propagated — both attempts would see "no account yet" and each would
 * write a SEPARATE document with a different random id. Two accounts, one
 * email.
 *
 * Deriving the document id from the normalized email instead (the same
 * pattern already used for phone-number uniqueness via `userPhones/{key}`)
 * makes the account id itself the uniqueness guarantee: no matter how many
 * times or how concurrently an account-creation write happens for a given
 * email, every one of them targets the exact same document, so the
 * database can only ever end up with one record (last write wins) instead
 * of two.
 */
export async function emailToUserId(email: string): Promise<string> {
  const hash = await hashPassword('user:' + email.trim().toLowerCase());
  return 'usr_' + hash.slice(0, 32);
}

// @deprecated use hashPassword instead — kept only so old imports don't break at load time.
export function simpleHash(str: string): string {
  console.warn('[db] simpleHash is deprecated and insecure. Use hashPassword().');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

// Re-export status checkers for convenience
export { getIsFirebaseConfigured as isFirebaseConfigured };
export { getIsSupabaseConfigured as isSupabaseConfigured };

// ─────────────────────────────────────────────────────────────────────────────
//  SUPABASE USER ACCOUNT HELPERS
//  Mirror the Firestore user helpers so auth works on both backends.
//  Table schema (create in Supabase SQL editor):
//    CREATE TABLE IF NOT EXISTS users (
//      id   TEXT PRIMARY KEY,
//      data JSONB NOT NULL
//    );
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upsert a UserProfile into Supabase users table.
 * Also updates the localStorage cache.
 */
export async function saveUserToSupabase(profile: import('./types').UserProfile): Promise<void> {
  if (!sbOk()) return;
  try {
    const { id, ...rest } = profile;
    const sb = getSupabaseClient();
    const { error } = await sb.from('users').upsert({ id, data: rest }, { onConflict: 'id' });
    if (error) throw error;
    saveUserProfile(profile); // keep localStorage cache in sync
  } catch (err) {
    console.warn('[Supabase] saveUserToSupabase failed:', err);
    throw err;
  }
}

/**
 * Fetch a UserProfile from Supabase by email.
 */
export async function getUserByEmailFromSupabase(email: string): Promise<import('./types').UserProfile | null> {
  if (!sbOk()) return null;
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('users')
      .select('id, data')
      .eq('data->>email', email.toLowerCase());
    if (error || !data || data.length === 0) return null;
    const row = data[0] as { id: string; data: Record<string, unknown> };
    return { id: row.id, ...row.data } as import('./types').UserProfile;
  } catch (err) {
    console.warn('[Supabase] getUserByEmailFromSupabase failed:', err);
    return null;
  }
}

/**
 * Fetch a UserProfile from Supabase by phoneKey.
 */
export async function getUserByPhoneFromSupabase(phoneKey: string): Promise<import('./types').UserProfile | null> {
  if (!sbOk()) return null;
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('users')
      .select('id, data')
      .eq('data->>phoneKey', phoneKey);
    if (error || !data || data.length === 0) return null;
    const row = data[0] as { id: string; data: Record<string, unknown> };
    return { id: row.id, ...row.data } as import('./types').UserProfile;
  } catch (err) {
    console.warn('[Supabase] getUserByPhoneFromSupabase failed:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ENGINE-AWARE USER ACCOUNT WRAPPERS
//  These are the functions AppContext should call — they automatically route
//  to Supabase, Firebase, or localStorage depending on the active engine.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Engine-aware: save a UserProfile to whichever backend the admin has
 * explicitly selected (Database settings → Local / Firebase / Supabase).
 *
 * IMPORTANT: this strictly follows `getActiveEngine()` — it does NOT fall
 * through to Firebase just because Firebase happens to have credentials
 * saved from a previous setup attempt. Without this guard, a store that
 * switched its active engine to Supabase (or back to Local) could keep
 * silently writing/reading user accounts from a stale Firebase project,
 * which is exactly how "the same email ends up with two accounts" bugs
 * happen — one record in the engine the admin thinks is active, another
 * in the engine the code actually used. localStorage is only ever used as
 * a same-device cache / last-resort fallback if the selected cloud write
 * itself fails (e.g. offline), never as a silent substitute engine.
 */
export async function saveUserAccount(
  profile: import('./types').UserProfile,
  options: { createPhoneIndex?: boolean } = {},
): Promise<void> {
  const engine = getActiveEngine();
  if (engine === 'supabase' && sbOk()) {
    await saveUserToSupabase(profile);
    return;
  }
  if (engine === 'firebase' && fbOk()) {
    try { await saveUserToFirestore(profile, options); return; }
    catch (e) { console.warn('[db] saveUserAccount Firebase failed, falling back to local:', e); }
  }
  saveUserProfile(profile);
}

/**
 * Engine-aware: fetch a UserProfile by email from the admin's selected
 * backend only (see saveUserAccount for why this must not fall through to
 * a non-active cloud engine — doing so is how duplicate-detection misses
 * an account that genuinely exists, letting a second one get created).
 */
export async function getUserByEmailAccount(email: string): Promise<import('./types').UserProfile | null> {
  const engine = getActiveEngine();
  if (engine === 'supabase' && sbOk()) {
    return getUserByEmailFromSupabase(email.toLowerCase());
  }
  if (engine === 'firebase' && fbOk()) {
    return getUserByEmailFromFirestore(email.toLowerCase());
  }
  return null;
}

/**
 * Engine-aware: fetch a UserProfile by phoneKey from the admin's selected
 * backend only. See saveUserAccount for rationale.
 */
export async function getUserByPhoneAccount(phoneKey: string): Promise<import('./types').UserProfile | null> {
  const engine = getActiveEngine();
  if (engine === 'supabase' && sbOk()) {
    return getUserByPhoneFromSupabase(phoneKey);
  }
  if (engine === 'firebase' && fbOk()) {
    return getUserByPhoneFromFirestore(phoneKey);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 3: PRODUCT GALLERY + VARIANTS
//  Dual-backend (Supabase / Firebase / localStorage) data layer.
//  All functions are engine-aware and mirror the pattern used by dbService.
//
//  Supabase tables required (run in SQL editor):
//    CREATE TABLE IF NOT EXISTS product_images (
//      id TEXT PRIMARY KEY, data JSONB NOT NULL
//    );
//    CREATE TABLE IF NOT EXISTS product_variant_groups (
//      id TEXT PRIMARY KEY, data JSONB NOT NULL
//    );
//    CREATE TABLE IF NOT EXISTS product_variants (
//      id TEXT PRIMARY KEY, data JSONB NOT NULL
//    );
//
//  Firebase: stored as subcollections under products/{id}/images,
//            products/{id}/variantGroups, products/{id}/variants
// ─────────────────────────────────────────────────────────────────────────────

import type { ProductImage, ProductVariant, ProductVariantGroup } from './types';

// ── Local in-memory stores (mirrors localStorage approach) ───────────────────
const _imgStore   = new Map<string, ProductImage[]>();   // productId → images
const _vgStore    = new Map<string, ProductVariantGroup[]>(); // productId → groups
const _varStore   = new Map<string, ProductVariant[]>(); // productId → variants

// ── localStorage helpers ─────────────────────────────────────────────────────
function _lsGet<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function _lsSet(key: string, val: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ── GALLERY IMAGES ────────────────────────────────────────────────────────────

/**
 * Fetch gallery images for a product.
 * Route: Supabase → Firebase subcollection → localStorage cache
 */
export async function getProductImages(productId: string): Promise<ProductImage[]> {
  const lsKey = `qf_pimg_${productId}`;

  // Supabase path
  if (sbOk()) {
    try {
      const sb = getSupabaseClient();
      const { data, error } = await sb
        .from('product_images')
        .select('id, data')
        .eq('data->>productId', productId)
        .order('data->>sortOrder', { ascending: true });
      if (!error && data) {
        const imgs: ProductImage[] = (data as { id: string; data: Record<string, unknown> }[]).map(r => ({ id: r.id, ...r.data }) as ProductImage);
        _imgStore.set(productId, imgs);
        _lsSet(lsKey, imgs);
        return imgs;
      }
    } catch (e) { console.warn('[db] getProductImages Supabase error:', e); }
  }

  // Firebase path
  if (fbOk()) {
    try {
      const snap = await getDocs(collection(getDb()!, `products/${productId}/images`));
      const imgs: ProductImage[] = [];
      snap.forEach(d => imgs.push({ id: d.id, ...d.data() } as ProductImage));
      imgs.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      _imgStore.set(productId, imgs);
      _lsSet(lsKey, imgs);
      return imgs;
    } catch (e) { console.warn('[db] getProductImages Firebase error:', e); }
  }

  // localStorage cache
  const cached = _lsGet<ProductImage[]>(lsKey);
  if (cached) { _imgStore.set(productId, cached); return cached; }
  return _imgStore.get(productId) || [];
}

/**
 * Save (overwrite) all gallery images for a product.
 */
export async function saveProductImages(productId: string, images: ProductImage[]): Promise<void> {
  const sorted = images.map((img, i) => ({ ...img, productId, sortOrder: i }));
  _imgStore.set(productId, sorted);
  _lsSet(`qf_pimg_${productId}`, sorted);

  if (sbOk()) {
    try {
      const sb = getSupabaseClient();
      // Delete all existing images for this product then re-insert
      await sb.from('product_images').delete().eq('data->>productId', productId);
      if (sorted.length > 0) {
        const rows = sorted.map(img => ({ id: img.id, data: img }));
        await sb.from('product_images').upsert(rows, { onConflict: 'id' });
      }
      return;
    } catch (e) { console.warn('[db] saveProductImages Supabase error:', e); }
  }

  if (fbOk()) {
    try {
      const batch = writeBatch(getDb()!);
      // Clear existing docs first (fetch then delete)
      const snap = await getDocs(collection(getDb()!, `products/${productId}/images`));
      snap.forEach(d => batch.delete(d.ref));
      sorted.forEach(img => {
        batch.set(doc(getDb()!, `products/${productId}/images`, img.id), img);
      });
      await batch.commit();
    } catch (e) { console.warn('[db] saveProductImages Firebase error:', e); }
  }
}

// ── VARIANT GROUPS ────────────────────────────────────────────────────────────

export async function getProductVariantGroups(productId: string): Promise<ProductVariantGroup[]> {
  const lsKey = `qf_pvg_${productId}`;

  if (sbOk()) {
    try {
      const sb = getSupabaseClient();
      const { data, error } = await sb
        .from('product_variant_groups')
        .select('id, data')
        .eq('data->>productId', productId);
      if (!error && data) {
        const groups: ProductVariantGroup[] = (data as { id: string; data: Record<string, unknown> }[]).map(r => ({ id: r.id, ...r.data }) as ProductVariantGroup);
        _vgStore.set(productId, groups);
        _lsSet(lsKey, groups);
        return groups;
      }
    } catch (e) { console.warn('[db] getProductVariantGroups Supabase error:', e); }
  }

  if (fbOk()) {
    try {
      const snap = await getDocs(collection(getDb()!, `products/${productId}/variantGroups`));
      const groups: ProductVariantGroup[] = [];
      snap.forEach(d => groups.push({ id: d.id, ...d.data() } as ProductVariantGroup));
      _vgStore.set(productId, groups);
      _lsSet(lsKey, groups);
      return groups;
    } catch (e) { console.warn('[db] getProductVariantGroups Firebase error:', e); }
  }

  const cached = _lsGet<ProductVariantGroup[]>(lsKey);
  if (cached) { _vgStore.set(productId, cached); return cached; }
  return _vgStore.get(productId) || [];
}

export async function saveProductVariantGroups(productId: string, groups: ProductVariantGroup[]): Promise<void> {
  const withId = groups.map(g => ({ ...g, productId }));
  _vgStore.set(productId, withId);
  _lsSet(`qf_pvg_${productId}`, withId);

  if (sbOk()) {
    try {
      const sb = getSupabaseClient();
      await sb.from('product_variant_groups').delete().eq('data->>productId', productId);
      if (withId.length > 0) {
        await sb.from('product_variant_groups').upsert(withId.map(g => ({ id: g.id, data: g })), { onConflict: 'id' });
      }
      return;
    } catch (e) { console.warn('[db] saveProductVariantGroups Supabase error:', e); }
  }

  if (fbOk()) {
    try {
      const batch = writeBatch(getDb()!);
      const snap = await getDocs(collection(getDb()!, `products/${productId}/variantGroups`));
      snap.forEach(d => batch.delete(d.ref));
      withId.forEach(g => batch.set(doc(getDb()!, `products/${productId}/variantGroups`, g.id), g));
      await batch.commit();
    } catch (e) { console.warn('[db] saveProductVariantGroups Firebase error:', e); }
  }
}

// ── VARIANTS ──────────────────────────────────────────────────────────────────

export async function getProductVariants(productId: string): Promise<ProductVariant[]> {
  const lsKey = `qf_pvar_${productId}`;

  if (sbOk()) {
    try {
      const sb = getSupabaseClient();
      const { data, error } = await sb
        .from('product_variants')
        .select('id, data')
        .eq('data->>productId', productId);
      if (!error && data) {
        const variants: ProductVariant[] = (data as { id: string; data: Record<string, unknown> }[]).map(r => ({ id: r.id, ...r.data }) as ProductVariant);
        _varStore.set(productId, variants);
        _lsSet(lsKey, variants);
        return variants;
      }
    } catch (e) { console.warn('[db] getProductVariants Supabase error:', e); }
  }

  if (fbOk()) {
    try {
      const snap = await getDocs(collection(getDb()!, `products/${productId}/variants`));
      const variants: ProductVariant[] = [];
      snap.forEach(d => variants.push({ id: d.id, ...d.data() } as ProductVariant));
      _varStore.set(productId, variants);
      _lsSet(lsKey, variants);
      return variants;
    } catch (e) { console.warn('[db] getProductVariants Firebase error:', e); }
  }

  const cached = _lsGet<ProductVariant[]>(lsKey);
  if (cached) { _varStore.set(productId, cached); return cached; }
  return _varStore.get(productId) || [];
}

export async function saveProductVariants(productId: string, variants: ProductVariant[]): Promise<void> {
  const withId = variants.map(v => ({ ...v, productId }));
  _varStore.set(productId, withId);
  _lsSet(`qf_pvar_${productId}`, withId);

  if (sbOk()) {
    try {
      const sb = getSupabaseClient();
      await sb.from('product_variants').delete().eq('data->>productId', productId);
      if (withId.length > 0) {
        await sb.from('product_variants').upsert(withId.map(v => ({ id: v.id, data: v })), { onConflict: 'id' });
      }
      return;
    } catch (e) { console.warn('[db] saveProductVariants Supabase error:', e); }
  }

  if (fbOk()) {
    try {
      const batch = writeBatch(getDb()!);
      const snap = await getDocs(collection(getDb()!, `products/${productId}/variants`));
      snap.forEach(d => batch.delete(d.ref));
      withId.forEach(v => batch.set(doc(getDb()!, `products/${productId}/variants`, v.id), v));
      await batch.commit();
    } catch (e) { console.warn('[db] saveProductVariants Firebase error:', e); }
  }
}

/**
 * Batch-fetch variants for multiple products in one call.
 * Returns a map: productId → ProductVariant[]
 */
export async function getVariantsForProducts(productIds: string[]): Promise<Map<string, ProductVariant[]>> {
  const result = new Map<string, ProductVariant[]>();
  if (productIds.length === 0) return result;

  if (sbOk()) {
    try {
      const sb = getSupabaseClient();
      // Fetch all variants for all product IDs in one query using `in`
      const { data, error } = await sb
        .from('product_variants')
        .select('id, data')
        .in('data->>productId', productIds);
      if (!error && data) {
        for (const row of data as { id: string; data: Record<string, unknown> }[]) {
          const v = { id: row.id, ...row.data } as ProductVariant;
          const list = result.get(v.productId) || [];
          list.push(v);
          result.set(v.productId, list);
        }
        // Cache each product's variants
        result.forEach((variants, pid) => {
          _varStore.set(pid, variants);
          _lsSet(`qf_pvar_${pid}`, variants);
        });
        return result;
      }
    } catch (e) { console.warn('[db] getVariantsForProducts Supabase error:', e); }
  }

  // Fallback: fetch individually
  await Promise.all(productIds.map(async (pid) => {
    const variants = await getProductVariants(pid);
    result.set(pid, variants);
  }));
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
//  REALTIME SUBSCRIPTIONS
//  Unified realtime listeners that work across Firebase and Supabase.
//  All subscribe* functions return an unsubscribe/cleanup function.
//  For the 'local' engine (no cloud backend) subscriptions are no-ops.
// ─────────────────────────────────────────────────────────────────────────────

type Unsubscribe = () => void;

/**
 * Subscribe to realtime product collection changes.
 * Firebase: onSnapshot on the 'products' collection.
 * Supabase: postgres_changes channel on the 'products' table.
 * Local: no-op (BroadcastChannel handles cross-tab sync separately).
 */
export function subscribeProducts(callback: (products: Product[]) => void): Unsubscribe {
  if (fbOk()) {
    const unsub = onSnapshot(
      collection(getDb()!, 'products'),
      (snap) => {
        const list: Product[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Product));
        callback(list);
      },
      (err) => console.warn('[db] subscribeProducts Firebase error:', err),
    );
    return unsub;
  }
  if (sbOk()) {
    const sb = getSupabaseClient();
    const channel = sb
      .channel('db-products')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, async () => {
        const { data } = await sb.from('products').select('id, data');
        if (data) callback(data.map((r: { id: string; data: Record<string, unknown> }) => ({ id: r.id, ...r.data } as Product)));
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }
  return () => {};
}

/**
 * Subscribe to realtime order collection changes.
 * Firebase: onSnapshot on the 'orders' collection.
 * Supabase: postgres_changes channel on the 'orders' table.
 */
export function subscribeOrders(callback: (orders: Order[]) => void): Unsubscribe {
  if (fbOk()) {
    const unsub = onSnapshot(
      collection(getDb()!, 'orders'),
      (snap) => {
        const list: Order[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Order));
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        callback(list);
      },
      (err) => console.warn('[db] subscribeOrders Firebase error:', err),
    );
    return unsub;
  }
  if (sbOk()) {
    const sb = getSupabaseClient();
    const channel = sb
      .channel('db-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => {
        const { data } = await sb.from('orders').select('id, data');
        if (data) {
          const list = data.map((r: { id: string; data: Record<string, unknown> }) => ({ id: r.id, ...r.data } as Order));
          list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          callback(list);
        }
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }
  return () => {};
}

/**
 * Subscribe to realtime review collection changes.
 * Firebase: onSnapshot on the 'reviews' collection.
 * Supabase: postgres_changes channel on the 'reviews' table.
 */
export function subscribeReviews(callback: (reviews: Review[]) => void): Unsubscribe {
  if (fbOk()) {
    const unsub = onSnapshot(
      collection(getDb()!, 'reviews'),
      (snap) => {
        const list: Review[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Review));
        callback(list);
      },
      (err) => console.warn('[db] subscribeReviews Firebase error:', err),
    );
    return unsub;
  }
  if (sbOk()) {
    const sb = getSupabaseClient();
    const channel = sb
      .channel('db-reviews')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, async () => {
        const { data } = await sb.from('reviews').select('id, data');
        if (data) callback(data.map((r: { id: string; data: Record<string, unknown> }) => ({ id: r.id, ...r.data } as Review)));
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }
  return () => {};
}

/**
 * Subscribe to realtime category collection changes.
 * Firebase: onSnapshot on the 'categories' collection.
 * Supabase: postgres_changes channel on the 'categories' table.
 */
export function subscribeCategories(callback: (categories: Category[]) => void): Unsubscribe {
  if (fbOk()) {
    const unsub = onSnapshot(
      collection(getDb()!, 'categories'),
      (snap) => {
        const list: Category[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Category));
        callback(list);
      },
      (err) => console.warn('[db] subscribeCategories Firebase error:', err),
    );
    return unsub;
  }
  if (sbOk()) {
    const sb = getSupabaseClient();
    const channel = sb
      .channel('db-categories')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, async () => {
        const { data } = await sb.from('categories').select('id, data');
        if (data) callback(data.map((r: { id: string; data: Record<string, unknown> }) => ({ id: r.id, ...r.data } as Category)));
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }
  return () => {};
}

/**
 * Subscribe to realtime coupon collection changes.
 * Firebase: onSnapshot on the 'coupons' collection.
 * Supabase: postgres_changes channel on the 'coupons' table.
 */
export function subscribeCoupons(callback: (coupons: Coupon[]) => void): Unsubscribe {
  if (fbOk()) {
    const unsub = onSnapshot(
      collection(getDb()!, 'coupons'),
      (snap) => {
        const list: Coupon[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Coupon));
        callback(list);
      },
      (err) => console.warn('[db] subscribeCoupons Firebase error:', err),
    );
    return unsub;
  }
  if (sbOk()) {
    const sb = getSupabaseClient();
    const channel = sb
      .channel('db-coupons')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coupons' }, async () => {
        const { data } = await sb.from('coupons').select('id, data');
        if (data) callback(data.map((r: { id: string; data: Record<string, unknown> }) => ({ id: r.id, ...r.data } as Coupon)));
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }
  return () => {};
}

/**
 * Subscribe to realtime newsletter subscriber collection changes.
 * Firebase: onSnapshot on the 'newsletter' collection.
 * Supabase: postgres_changes channel on the 'newsletter' table.
 */
export function subscribeNewsletterSubscribers(callback: (subscribers: NewsletterSubscriber[]) => void): Unsubscribe {
  if (fbOk()) {
    const unsub = onSnapshot(
      collection(getDb()!, 'newsletter'),
      (snap) => {
        const list: NewsletterSubscriber[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as NewsletterSubscriber));
        callback(list);
      },
      (err) => console.warn('[db] subscribeNewsletterSubscribers Firebase error:', err),
    );
    return unsub;
  }
  if (sbOk()) {
    const sb = getSupabaseClient();
    const channel = sb
      .channel('db-newsletter')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'newsletter' }, async () => {
        const { data } = await sb.from('newsletter').select('id, data');
        if (data) callback(data.map((r: { id: string; data: Record<string, unknown> }) => ({ id: r.id, ...r.data } as NewsletterSubscriber)));
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }
  return () => {};
}

/**
 * Subscribe to realtime siteSettings document changes.
 * Firebase: onSnapshot on the 'settings/siteSettings' document.
 * Supabase: postgres_changes channel on the 'settings' table filtered by key='siteSettings'.
 */
export function subscribeSiteSettings(callback: (settings: SiteSettings | null) => void): Unsubscribe {
  if (fbOk()) {
    const unsub = onSnapshot(
      doc(getDb()!, 'settings', 'siteSettings'),
      (snap) => {
        callback(snap.exists() ? (snap.data() as SiteSettings) : null);
      },
      (err) => console.warn('[db] subscribeSiteSettings Firebase error:', err),
    );
    return unsub;
  }
  if (sbOk()) {
    const sb = getSupabaseClient();
    const channel = sb
      .channel('db-siteSettings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settings', filter: "key=eq.siteSettings" },
        async () => {
          const { data } = await sb.from('settings').select('value').eq('key', 'siteSettings').single();
          callback(data ? (data.value as SiteSettings) : null);
        },
      )
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }
  return () => {};
}

/**
 * Subscribe to realtime changes of any settings document (by key).
 * Firebase: onSnapshot on the 'settings/{key}' document.
 * Supabase: postgres_changes channel on the 'settings' table filtered by key.
 */
export function subscribeSettingsDoc(key: string, callback: (data: Record<string, unknown> | null) => void): Unsubscribe {
  if (fbOk()) {
    const unsub = onSnapshot(
      doc(getDb()!, 'settings', key),
      (snap) => {
        callback(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
      },
      (err) => console.warn(`[db] subscribeSettingsDoc(${key}) Firebase error:`, err),
    );
    return unsub;
  }
  if (sbOk()) {
    const sb = getSupabaseClient();
    const channel = sb
      .channel(`db-settings-${key}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settings', filter: `key=eq.${key}` },
        async () => {
          const { data } = await sb.from('settings').select('value').eq('key', key).single();
          callback(data ? (data.value as Record<string, unknown>) : null);
        },
      )
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }
  return () => {};
}

// ─────────────────────────────────────────────────────────────────────────────
//  SEED DEFAULT DATA
//  Batch-writes default store data to the active backend.
//  Used by InstallWizard and AppContext auto-seed on first Firebase connect.
// ─────────────────────────────────────────────────────────────────────────────

export interface SeedOptions {
  products?: Product[];
  categories?: Category[];
  coupons?: Coupon[];
  reviews?: Review[];
  siteSettings?: Partial<SiteSettings>;
  paymentSettings?: PaymentSettings;
  smtpSettings?: SMTPSettings;
  supportSettings?: SupportSettings;
  adminSettings?: AdminCredentials;
  installStatus?: Record<string, unknown>;
}

/**
 * Seed the active backend with default store data.
 * Firebase: uses a single writeBatch for all collection writes, then individual
 *   setDoc calls for settings documents.
 * Supabase: upserts each record individually using the existing dbService methods.
 * Local: writes to localStorage via dbService methods.
 */
export async function seedDefaultData(opts: SeedOptions): Promise<void> {
  const {
    products = [],
    categories = [],
    coupons = [],
    reviews = [],
    siteSettings,
    paymentSettings,
    smtpSettings,
    supportSettings,
    adminSettings,
    installStatus,
  } = opts;

  if (fbOk()) {
    const db = getDb()!;

    // Batch-write all collection documents in a single round-trip
    if (products.length || categories.length || coupons.length || reviews.length) {
      const batch = writeBatch(db);
      for (const p of products)    batch.set(doc(db, 'products',   p.id), p);
      for (const c of categories)  batch.set(doc(db, 'categories', c.id), c);
      for (const c of coupons)     batch.set(doc(db, 'coupons',    c.id), c);
      for (const r of reviews)     batch.set(doc(db, 'reviews',    r.id), r);
      await batch.commit();
    }

    // Settings documents — individual setDoc calls (each is a separate document)
    const settingsWrites: Promise<void>[] = [];
    if (siteSettings)     settingsWrites.push(setDoc(doc(db, 'settings', 'siteSettings'),     siteSettings));
    if (paymentSettings)  settingsWrites.push(setDoc(doc(db, 'settings', 'paymentSettings'),  paymentSettings));
    if (smtpSettings)     settingsWrites.push(setDoc(doc(db, 'settings', 'smtpSettings'),     smtpSettings));
    if (supportSettings)  settingsWrites.push(setDoc(doc(db, 'settings', 'supportSettings'),  supportSettings));
    if (adminSettings)    settingsWrites.push(setDoc(doc(db, 'settings', 'adminSettings'),    adminSettings));
    if (installStatus)    settingsWrites.push(setDoc(doc(db, 'settings', 'install_status'),   installStatus));
    if (settingsWrites.length) await Promise.all(settingsWrites);
    return;
  }

  // Supabase or local: use existing dbService methods
  const writes: Promise<void>[] = [];
  for (const p of products)   writes.push(dbService.saveProduct(p));
  for (const c of categories) writes.push(dbService.saveCategory(c));
  for (const c of coupons)    writes.push(dbService.saveCoupon(c));
  for (const r of reviews)    writes.push(dbService.saveReview(r));
  if (writes.length) await Promise.all(writes);

  if (siteSettings)    await dbService.saveSiteSettings(siteSettings as SiteSettings);
  if (paymentSettings) await dbService.savePaymentSettings(paymentSettings);
  if (smtpSettings)    await dbService.saveSMTPSettings(smtpSettings);
  if (supportSettings) await dbService.saveSupportSettings(supportSettings);
  if (adminSettings)   await dbService.saveAdminSettings(adminSettings);
}

// ─────────────────────────────────────────────────────────────────────────────
//  FIREBASE AUTH ABSTRACTIONS
//  All Firebase Auth operations are centralised here so no other file needs
//  to import from 'firebase/auth'.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sign in to Firebase Auth with email and password.
 * Returns the signed-in user credential, or throws on failure.
 * No-op (returns null) when Firebase is not configured.
 */
export async function signInAdmin(
  email: string,
  password: string,
): Promise<{ user: User } | null> {
  if (!_firebaseAuth) return null;
  return signInWithEmailAndPassword(_firebaseAuth, email, password);
}

/**
 * Create a new Firebase Auth user with email and password.
 * Returns the new user credential, or throws on failure.
 * No-op (returns null) when Firebase is not configured.
 */
export async function createAdminAccount(
  email: string,
  password: string,
): Promise<{ user: User } | null> {
  if (!_firebaseAuth) return null;
  return createUserWithEmailAndPassword(_firebaseAuth, email, password);
}

/**
 * Sign out the currently signed-in Firebase Auth user.
 * No-op when Firebase is not configured or no user is signed in.
 */
export async function signOutAdmin(): Promise<void> {
  if (!_firebaseAuth) return;
  try { await _fbSignOut(_firebaseAuth); } catch { /* silent */ }
}

/**
 * Update the password of the currently signed-in Firebase Auth user.
 * No-op when Firebase is not configured or no user is signed in.
 */
export async function updateAdminPassword(newPassword: string): Promise<void> {
  if (!_firebaseAuth?.currentUser) return;
  await updatePassword(_firebaseAuth.currentUser, newPassword);
}

/**
 * Subscribe to Firebase Auth state changes.
 * The callback fires immediately with the current user (or null).
 * Returns an unsubscribe function.
 * Returns a no-op unsubscribe when Firebase is not configured.
 */
export function onAuthStateChange(callback: (user: User | null) => void): Unsubscribe {
  if (!_firebaseAuth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(_firebaseAuth, callback);
}
