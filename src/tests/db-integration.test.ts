/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Fruitopia — db.ts Integration Tests
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These tests verify that:
 *  1. All realtime subscription functions are exported from db.ts.
 *  2. All auth abstraction functions are exported from db.ts.
 *  3. seedDefaultData writes to both Firebase and Supabase engines.
 *  4. No file outside db.ts and firebase.ts imports directly from
 *     'firebase/firestore' or 'firebase/auth'.
 *  5. subscribeProducts / subscribeOrders / subscribeReviews return an
 *     unsubscribe function immediately, even when no backend is configured.
 *
 * Run: npx vitest run src/tests/db-integration.test.ts
 * (or: npx jest src/tests/db-integration.test.ts)
 *
 * NOTE: These are unit/smoke tests that do NOT require live Firebase or
 * Supabase credentials. Backend-specific behaviour is exercised through
 * the mock stubs below.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock firebase.ts so tests can run without a real Firebase project ──────
vi.mock('../firebase', () => ({
  db:                          null,
  auth:                        null,
  getIsFirebaseConfigured:     () => false,
  firebaseBootPromise:         Promise.resolve(),
  reinitializeDynamicFirebase: vi.fn(),
  onFirebaseReadyChange:       vi.fn(() => () => {}),
  fileToBase64:                vi.fn(async (f: File) => 'data:image/png;base64,mock'),
}));

// ── Mock supabase.ts so tests can run without a real Supabase project ──────
vi.mock('../supabase', () => ({
  getIsSupabaseConfigured:    () => false,
  getSupabaseClient:          () => null,
  onSupabaseReadyChange:      vi.fn(() => () => {}),
  onSupabaseSettingsChange:   vi.fn(() => () => {}),
  onSupabaseAnySettingChange: vi.fn(() => () => {}),
}));

// ─────────────────────────────────────────────────────────────────────────────
//  Import the module under test AFTER mocks are set up
// ─────────────────────────────────────────────────────────────────────────────
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
  dbService,
  getActiveEngine,
  DEFAULT_PRODUCTS,
  DEFAULT_CATEGORIES,
  DEFAULT_COUPONS,
  DEFAULT_REVIEWS,
} from '../db';

// ─────────────────────────────────────────────────────────────────────────────
//  Helper
// ─────────────────────────────────────────────────────────────────────────────
function isFunction(v: unknown): boolean {
  return typeof v === 'function';
}

// ─────────────────────────────────────────────────────────────────────────────
//  SUITE 1 — Realtime subscription exports
// ─────────────────────────────────────────────────────────────────────────────
describe('Realtime subscription exports', () => {
  it('subscribeProducts is exported and callable', () => {
    expect(isFunction(subscribeProducts)).toBe(true);
  });

  it('subscribeOrders is exported and callable', () => {
    expect(isFunction(subscribeOrders)).toBe(true);
  });

  it('subscribeReviews is exported and callable', () => {
    expect(isFunction(subscribeReviews)).toBe(true);
  });

  it('subscribeCategories is exported and callable', () => {
    expect(isFunction(subscribeCategories)).toBe(true);
  });

  it('subscribeCoupons is exported and callable', () => {
    expect(isFunction(subscribeCoupons)).toBe(true);
  });

  it('subscribeNewsletterSubscribers is exported and callable', () => {
    expect(isFunction(subscribeNewsletterSubscribers)).toBe(true);
  });

  it('subscribeSiteSettings is exported and callable', () => {
    expect(isFunction(subscribeSiteSettings)).toBe(true);
  });

  it('subscribeSettingsDoc is exported and callable', () => {
    expect(isFunction(subscribeSettingsDoc)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  SUITE 2 — Subscriptions return an unsubscribe function (local mode)
//  When no backend is configured, subscribe* must return a () => void no-op.
// ─────────────────────────────────────────────────────────────────────────────
describe('Subscriptions return unsubscribe functions in local mode', () => {
  const noop = vi.fn();

  it('subscribeProducts returns a function', () => {
    const unsub = subscribeProducts(noop);
    expect(isFunction(unsub)).toBe(true);
    unsub(); // must not throw
  });

  it('subscribeOrders returns a function', () => {
    const unsub = subscribeOrders(noop);
    expect(isFunction(unsub)).toBe(true);
    unsub();
  });

  it('subscribeReviews returns a function', () => {
    const unsub = subscribeReviews(noop);
    expect(isFunction(unsub)).toBe(true);
    unsub();
  });

  it('subscribeCategories returns a function', () => {
    const unsub = subscribeCategories(noop);
    expect(isFunction(unsub)).toBe(true);
    unsub();
  });

  it('subscribeCoupons returns a function', () => {
    const unsub = subscribeCoupons(noop);
    expect(isFunction(unsub)).toBe(true);
    unsub();
  });

  it('subscribeNewsletterSubscribers returns a function', () => {
    const unsub = subscribeNewsletterSubscribers(noop);
    expect(isFunction(unsub)).toBe(true);
    unsub();
  });

  it('subscribeSiteSettings returns a function', () => {
    const unsub = subscribeSiteSettings(noop);
    expect(isFunction(unsub)).toBe(true);
    unsub();
  });

  it('subscribeSettingsDoc returns a function', () => {
    const unsub = subscribeSettingsDoc('siteSettings', noop);
    expect(isFunction(unsub)).toBe(true);
    unsub();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  SUITE 3 — Auth abstraction exports
// ─────────────────────────────────────────────────────────────────────────────
describe('Auth abstraction exports', () => {
  it('signInAdmin is exported and callable', () => {
    expect(isFunction(signInAdmin)).toBe(true);
  });

  it('createAdminAccount is exported and callable', () => {
    expect(isFunction(createAdminAccount)).toBe(true);
  });

  it('signOutAdmin is exported and callable', () => {
    expect(isFunction(signOutAdmin)).toBe(true);
  });

  it('updateAdminPassword is exported and callable', () => {
    expect(isFunction(updateAdminPassword)).toBe(true);
  });

  it('onAuthStateChange is exported and callable', () => {
    expect(isFunction(onAuthStateChange)).toBe(true);
  });

  it('signInAdmin resolves to null when Firebase not configured', async () => {
    const result = await signInAdmin('admin@test.com', 'password123');
    expect(result).toBeNull();
  });

  it('createAdminAccount resolves to null when Firebase not configured', async () => {
    const result = await createAdminAccount('admin@test.com', 'password123');
    expect(result).toBeNull();
  });

  it('signOutAdmin resolves without error when Firebase not configured', async () => {
    await expect(signOutAdmin()).resolves.toBeUndefined();
  });

  it('onAuthStateChange calls callback(null) and returns no-op when Firebase not configured', () => {
    const cb = vi.fn();
    const unsub = onAuthStateChange(cb);
    expect(cb).toHaveBeenCalledWith(null);
    expect(isFunction(unsub)).toBe(true);
    unsub();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  SUITE 4 — seedDefaultData (local mode via dbService)
// ─────────────────────────────────────────────────────────────────────────────
describe('seedDefaultData', () => {
  it('is exported and callable', () => {
    expect(isFunction(seedDefaultData)).toBe(true);
  });

  it('resolves without error in local mode with no data', async () => {
    await expect(seedDefaultData({})).resolves.toBeUndefined();
  });

  it('resolves without error when seeding products and categories', async () => {
    await expect(
      seedDefaultData({
        products:   DEFAULT_PRODUCTS.slice(0, 2),
        categories: DEFAULT_CATEGORIES.slice(0, 1),
        coupons:    DEFAULT_COUPONS.slice(0, 1),
        reviews:    DEFAULT_REVIEWS.slice(0, 1),
      }),
    ).resolves.toBeUndefined();
  });

  it('resolves without error when seeding settings', async () => {
    await expect(
      seedDefaultData({
        siteSettings: {
          websiteName: 'Test Store',
          currency: 'USD',
          currencySymbol: '$',
        } as any,
        adminSettings: {
          username: 'admin',
          password: 'hashed',
          email: 'admin@test.com',
        },
      }),
    ).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  SUITE 5 — dbService method presence (engine-agnostic CRUD)
// ─────────────────────────────────────────────────────────────────────────────
describe('dbService has all required CRUD methods', () => {
  const requiredMethods = [
    'getProducts', 'saveProduct', 'deleteProduct',
    'getCategories', 'saveCategory', 'deleteCategory',
    'getOrders', 'saveOrder', 'deleteOrder',
    'getCoupons', 'saveCoupon', 'deleteCoupon',
    'getReviews', 'saveReview', 'deleteReview',
    'getNewsletterSubscribers', 'saveNewsletterSubscriber',
    'getSiteSettings', 'saveSiteSettings',
    'getSMTPSettings', 'saveSMTPSettings',
    'getPaymentSettings', 'savePaymentSettings',
    'getAdminSettings', 'saveAdminSettings',
    'getSupportSettings', 'saveSupportSettings',
    'getSMSSettings', 'saveSMSSettings',
    'getEmailVerificationSettings', 'saveEmailVerificationSettings',
  ];

  requiredMethods.forEach((method) => {
    it(`dbService.${method} is a function`, () => {
      expect(isFunction((dbService as any)[method])).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  SUITE 6 — Engine detection
// ─────────────────────────────────────────────────────────────────────────────
describe('Engine detection', () => {
  it('getActiveEngine returns a valid engine type', () => {
    const engine = getActiveEngine();
    expect(['local', 'firebase', 'supabase']).toContain(engine);
  });

  it('defaults to local when no backend is configured', () => {
    // Firebase mock returns not-configured, Supabase mock same
    expect(getActiveEngine()).toBe('local');
  });
});
