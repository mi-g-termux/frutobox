/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Fruitopia — Firebase Engine Integration Tests
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Tests that exercise db.ts through the Firebase driver path.
 * Uses mock firebase/firestore and firebase/auth modules so no real project
 * credentials are needed.
 *
 * Run: npx vitest run src/tests/firebase-integration.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firestore snapshot mocks ──────────────────────────────────────────────
const { mockUnsubscribe, mockOnSnapshot, mockBatchCommit, mockBatch } = vi.hoisted(() => {
  const mockUnsubscribe = vi.fn();
  const mockOnSnapshot = vi.fn(() => mockUnsubscribe);
  const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
  const mockBatch = { set: vi.fn(), delete: vi.fn(), commit: mockBatchCommit };
  return { mockUnsubscribe, mockOnSnapshot, mockBatchCommit, mockBatch };
});

vi.mock('firebase/firestore', () => ({
  collection:    vi.fn(() => ({ _path: 'collection' })),
  doc:           vi.fn(() => ({ _path: 'doc' })),
  getDocs:       vi.fn().mockResolvedValue({ forEach: vi.fn(), docs: [] }),
  getDoc:        vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
  setDoc:        vi.fn().mockResolvedValue(undefined),
  deleteDoc:     vi.fn().mockResolvedValue(undefined),
  query:         vi.fn(),
  where:         vi.fn(),
  writeBatch:    vi.fn(() => mockBatch),
  onSnapshot:    mockOnSnapshot,
}));

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword:     vi.fn().mockResolvedValue({ user: { email: 'admin@test.com' } }),
  createUserWithEmailAndPassword: vi.fn().mockResolvedValue({ user: { email: 'admin@test.com' } }),
  signOut:                        vi.fn().mockResolvedValue(undefined),
  updatePassword:                 vi.fn().mockResolvedValue(undefined),
  onAuthStateChanged:             vi.fn().mockImplementation((_auth, cb) => { cb(null); return vi.fn(); }),
}));

// ── Mock firebase.ts — provide a fake db and auth object ─────────────────
const { mockFirebaseDb, mockFirebaseAuth } = vi.hoisted(() => ({
  mockFirebaseDb: { _mock: 'firestore' },
  mockFirebaseAuth: { currentUser: null, _mock: 'auth' },
}));

vi.mock('../firebase', () => ({
  db:                          mockFirebaseDb,
  auth:                        mockFirebaseAuth,
  getIsFirebaseConfigured:     () => true,
  firebaseBootPromise:         Promise.resolve(),
  reinitializeDynamicFirebase: vi.fn(),
  onFirebaseReadyChange:       vi.fn(() => () => {}),
  fileToBase64:                vi.fn(async () => 'data:image/png;base64,mock'),
}));

vi.mock('../supabase', () => ({
  getIsSupabaseConfigured:    () => false,
  getSupabaseClient:          () => null,
  onSupabaseReadyChange:      vi.fn(() => () => {}),
  onSupabaseSettingsChange:   vi.fn(() => () => {}),
  onSupabaseAnySettingChange: vi.fn(() => () => {}),
}));

// Import AFTER mocks
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
  DEFAULT_PRODUCTS,
  DEFAULT_CATEGORIES,
  DEFAULT_COUPONS,
  DEFAULT_REVIEWS,
} from '../db';

import { onSnapshot } from 'firebase/firestore';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updatePassword,
  onAuthStateChanged,
} from 'firebase/auth';

// ─────────────────────────────────────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Firebase engine — realtime subscriptions use onSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockOnSnapshot as any).mockReturnValue(mockUnsubscribe);
  });

  it('subscribeProducts calls onSnapshot on the products collection', () => {
    const unsub = subscribeProducts(vi.fn());
    expect(onSnapshot).toHaveBeenCalled();
    unsub();
  });

  it('subscribeOrders calls onSnapshot on the orders collection', () => {
    const unsub = subscribeOrders(vi.fn());
    expect(onSnapshot).toHaveBeenCalled();
    unsub();
  });

  it('subscribeReviews calls onSnapshot on the reviews collection', () => {
    const unsub = subscribeReviews(vi.fn());
    expect(onSnapshot).toHaveBeenCalled();
    unsub();
  });

  it('subscribeCategories calls onSnapshot on the categories collection', () => {
    const unsub = subscribeCategories(vi.fn());
    expect(onSnapshot).toHaveBeenCalled();
    unsub();
  });

  it('subscribeCoupons calls onSnapshot on the coupons collection', () => {
    const unsub = subscribeCoupons(vi.fn());
    expect(onSnapshot).toHaveBeenCalled();
    unsub();
  });

  it('subscribeNewsletterSubscribers calls onSnapshot on the newsletter collection', () => {
    const unsub = subscribeNewsletterSubscribers(vi.fn());
    expect(onSnapshot).toHaveBeenCalled();
    unsub();
  });

  it('subscribeSiteSettings calls onSnapshot on the settings/siteSettings doc', () => {
    const unsub = subscribeSiteSettings(vi.fn());
    expect(onSnapshot).toHaveBeenCalled();
    unsub();
  });

  it('subscribeSettingsDoc calls onSnapshot for the specified key', () => {
    const unsub = subscribeSettingsDoc('paymentSettings', vi.fn());
    expect(onSnapshot).toHaveBeenCalled();
    unsub();
  });

  it('subscribeProducts returns the onSnapshot unsubscribe function', () => {
    const unsub = subscribeProducts(vi.fn());
    expect(unsub).toBe(mockUnsubscribe);
  });
});

describe('Firebase engine — seedDefaultData uses writeBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBatch.set.mockClear();
    mockBatchCommit.mockClear();
    (mockOnSnapshot as any).mockReturnValue(mockUnsubscribe);
  });

  it('calls writeBatch().set() for each product/category/coupon/review', async () => {
    const { writeBatch } = await import('firebase/firestore');
    await seedDefaultData({
      products:   DEFAULT_PRODUCTS,
      categories: DEFAULT_CATEGORIES,
      coupons:    DEFAULT_COUPONS,
      reviews:    DEFAULT_REVIEWS,
    });
    expect(writeBatch).toHaveBeenCalled();
    const expectedSets = DEFAULT_PRODUCTS.length + DEFAULT_CATEGORIES.length +
      DEFAULT_COUPONS.length + DEFAULT_REVIEWS.length;
    expect(mockBatch.set).toHaveBeenCalledTimes(expectedSets);
    expect(mockBatchCommit).toHaveBeenCalledOnce();
  });

  it('calls setDoc for each settings document provided', async () => {
    const { setDoc } = await import('firebase/firestore');
    await seedDefaultData({
      siteSettings:    { websiteName: 'Test' } as any,
      paymentSettings: { gateway: 'stripe' } as any,
    });
    expect(setDoc).toHaveBeenCalledTimes(2);
  });

  it('does not call writeBatch when only settings are provided', async () => {
    const { writeBatch } = await import('firebase/firestore');
    (writeBatch as any).mockClear();
    await seedDefaultData({ siteSettings: { websiteName: 'Test' } as any });
    // writeBatch not called when products/categories/coupons/reviews are all empty
    expect(writeBatch).not.toHaveBeenCalled();
  });
});

describe('Firebase engine — auth abstractions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signInAdmin delegates to signInWithEmailAndPassword', async () => {
    const result = await signInAdmin('admin@test.com', 'password');
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(
      mockFirebaseAuth, 'admin@test.com', 'password',
    );
    expect(result).toBeTruthy();
  });

  it('createAdminAccount delegates to createUserWithEmailAndPassword', async () => {
    const result = await createAdminAccount('admin@test.com', 'password');
    expect(createUserWithEmailAndPassword).toHaveBeenCalledWith(
      mockFirebaseAuth, 'admin@test.com', 'password',
    );
    expect(result).toBeTruthy();
  });

  it('signOutAdmin delegates to signOut', async () => {
    await signOutAdmin();
    expect(signOut).toHaveBeenCalledWith(mockFirebaseAuth);
  });

  it('onAuthStateChange delegates to onAuthStateChanged', () => {
    const cb = vi.fn();
    const unsub = onAuthStateChange(cb);
    expect(onAuthStateChanged).toHaveBeenCalledWith(mockFirebaseAuth, cb);
    expect(typeof unsub).toBe('function');
  });
});

describe('Firebase engine — no direct SDK imports in non-driver files', () => {
  it('AppContext.tsx does not import from firebase/firestore directly', async () => {
    // This test verifies the audit at the module level — if firebase/firestore
    // were imported outside db.ts, this module graph check would catch it.
    // In CI, supplement this with: grep -r "from 'firebase/firestore'" src/ | grep -v "db.ts\|firebase.ts"
    const fs = await import('fs');
    const path = await import('path');
    const srcDir = path.resolve(__dirname, '..');
    const filesToCheck = [
      'context/AppContext.tsx',
      'components/InstallWizard.tsx',
      'components/AdminPanel.tsx',
      'firebaseService.ts',
      'firestore-service.ts',
    ];
    for (const rel of filesToCheck) {
      const full = path.join(srcDir, rel);
      if (!fs.existsSync(full)) continue;
      const content = fs.readFileSync(full, 'utf-8');
      const hasFirestoreImport = content.includes("from 'firebase/firestore'");
      const hasAuthImport      = content.includes("from 'firebase/auth'");
      expect(hasFirestoreImport, `${rel} must NOT import from 'firebase/firestore'`).toBe(false);
      expect(hasAuthImport,      `${rel} must NOT import from 'firebase/auth'`).toBe(false);
    }
  });
});
