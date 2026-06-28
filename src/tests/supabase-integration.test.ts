/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Fruitopia — Supabase Engine Integration Tests
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Tests that exercise db.ts through the Supabase driver path.
 * Uses a mock Supabase client that records all calls so we can verify
 * the correct SQL operations are issued.
 *
 * Run: npx vitest run src/tests/supabase-integration.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock data store ────────────────────────────────────────────────────────
const mockStore: Record<string, Record<string, unknown>[]> = {
  products:   [],
  orders:     [],
  reviews:    [],
  categories: [],
  coupons:    [],
  newsletter: [],
};
const mockSettings: Record<string, unknown> = {};

// ── Supabase query builder mock ────────────────────────────────────────────
function makeQueryBuilder(table: string) {
  const builder: any = {
    _table:    table,
    _filters:  [] as { col: string; val: unknown }[],
    _data:     null as unknown,
    select:    vi.fn().mockReturnThis(),
    insert:    vi.fn().mockImplementation((data: unknown) => { builder._data = data; return builder; }),
    upsert:    vi.fn().mockImplementation((data: unknown) => { builder._data = data; return builder; }),
    delete:    vi.fn().mockReturnThis(),
    update:    vi.fn().mockImplementation((data: unknown) => { builder._data = data; return builder; }),
    eq:        vi.fn().mockImplementation((col: string, val: unknown) => { builder._filters.push({ col, val }); return builder; }),
    in:        vi.fn().mockReturnThis(),
    single:    vi.fn().mockImplementation(() => {
      if (table === 'settings') {
        const key = builder._filters.find((f: any) => f.col === 'key')?.val as string;
        const val = key ? mockSettings[key] : null;
        return Promise.resolve({ data: val ? { key, value: val } : null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    then:      (resolve: Function) => {
      // Default resolution returns current table data
      if (table === 'settings') {
        const entries = Object.entries(mockSettings).map(([key, value]) => ({ key, value }));
        return Promise.resolve({ data: entries, error: null }).then(resolve as any);
      }
      const rows = (mockStore[table] || []).map((r: any) => ({ id: r.id, data: r }));
      return Promise.resolve({ data: rows, error: null }).then(resolve as any);
    },
  };
  return builder;
}

// ── Mock Supabase client ───────────────────────────────────────────────────
const mockSupabaseClient = {
  from:    vi.fn().mockImplementation((table: string) => makeQueryBuilder(table)),
  channel: vi.fn().mockReturnValue({
    on:        vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  }),
  removeChannel: vi.fn(),
};

// ── Mock modules ───────────────────────────────────────────────────────────
vi.mock('../firebase', () => ({
  db:                          null,
  auth:                        null,
  getIsFirebaseConfigured:     () => false,
  firebaseBootPromise:         Promise.resolve(),
  reinitializeDynamicFirebase: vi.fn(),
  onFirebaseReadyChange:       vi.fn(() => () => {}),
  fileToBase64:                vi.fn(async () => 'data:image/png;base64,mock'),
}));

vi.mock('../supabase', () => ({
  getIsSupabaseConfigured:    () => true,
  getSupabaseClient:          () => mockSupabaseClient,
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
  dbService,
  seedDefaultData,
  DEFAULT_PRODUCTS,
  DEFAULT_CATEGORIES,
  DEFAULT_COUPONS,
  DEFAULT_REVIEWS,
  DEFAULT_SITE_SETTINGS,
} from '../db';

// ─────────────────────────────────────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Supabase engine — realtime subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('subscribeProducts creates a Supabase realtime channel', () => {
    const unsub = subscribeProducts(vi.fn());
    expect(mockSupabaseClient.channel).toHaveBeenCalledWith('db-products');
    unsub();
    expect(mockSupabaseClient.removeChannel).toHaveBeenCalled();
  });

  it('subscribeOrders creates a Supabase realtime channel', () => {
    const unsub = subscribeOrders(vi.fn());
    expect(mockSupabaseClient.channel).toHaveBeenCalledWith('db-orders');
    unsub();
  });

  it('subscribeReviews creates a Supabase realtime channel', () => {
    const unsub = subscribeReviews(vi.fn());
    expect(mockSupabaseClient.channel).toHaveBeenCalledWith('db-reviews');
    unsub();
  });

  it('subscribeCategories creates a Supabase realtime channel', () => {
    const unsub = subscribeCategories(vi.fn());
    expect(mockSupabaseClient.channel).toHaveBeenCalledWith('db-categories');
    unsub();
  });

  it('subscribeCoupons creates a Supabase realtime channel', () => {
    const unsub = subscribeCoupons(vi.fn());
    expect(mockSupabaseClient.channel).toHaveBeenCalledWith('db-coupons');
    unsub();
  });

  it('subscribeNewsletterSubscribers creates a Supabase realtime channel', () => {
    const unsub = subscribeNewsletterSubscribers(vi.fn());
    expect(mockSupabaseClient.channel).toHaveBeenCalledWith('db-newsletter');
    unsub();
  });

  it('subscribeSiteSettings creates a Supabase realtime channel', () => {
    const unsub = subscribeSiteSettings(vi.fn());
    expect(mockSupabaseClient.channel).toHaveBeenCalledWith('db-siteSettings');
    unsub();
  });

  it('subscribeSettingsDoc creates a channel keyed on the doc key', () => {
    const unsub = subscribeSettingsDoc('paymentSettings', vi.fn());
    expect(mockSupabaseClient.channel).toHaveBeenCalledWith('db-settings-paymentSettings');
    unsub();
  });

  it('subscribeProducts unsubscribe calls removeChannel', () => {
    const unsub = subscribeProducts(vi.fn());
    unsub();
    expect(mockSupabaseClient.removeChannel).toHaveBeenCalledTimes(1);
  });
});

describe('Supabase engine — seedDefaultData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls dbService.saveProduct for each product', async () => {
    const saveSpy = vi.spyOn(dbService, 'saveProduct').mockResolvedValue();
    await seedDefaultData({ products: DEFAULT_PRODUCTS.slice(0, 2) });
    expect(saveSpy).toHaveBeenCalledTimes(2);
    saveSpy.mockRestore();
  });

  it('calls dbService.saveCategory for each category', async () => {
    const saveSpy = vi.spyOn(dbService, 'saveCategory').mockResolvedValue();
    await seedDefaultData({ categories: DEFAULT_CATEGORIES.slice(0, 2) });
    expect(saveSpy).toHaveBeenCalledTimes(2);
    saveSpy.mockRestore();
  });

  it('calls dbService.saveCoupon for each coupon', async () => {
    const saveSpy = vi.spyOn(dbService, 'saveCoupon').mockResolvedValue();
    await seedDefaultData({ coupons: DEFAULT_COUPONS.slice(0, 1) });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    saveSpy.mockRestore();
  });

  it('calls dbService.saveReview for each review', async () => {
    const saveSpy = vi.spyOn(dbService, 'saveReview').mockResolvedValue();
    await seedDefaultData({ reviews: DEFAULT_REVIEWS.slice(0, 2) });
    expect(saveSpy).toHaveBeenCalledTimes(2);
    saveSpy.mockRestore();
  });

  it('calls dbService.saveSiteSettings when siteSettings provided', async () => {
    const saveSpy = vi.spyOn(dbService, 'saveSiteSettings').mockResolvedValue();
    const getSpy  = vi.spyOn(dbService, 'getSiteSettings').mockResolvedValue(DEFAULT_SITE_SETTINGS as any);
    await seedDefaultData({ siteSettings: { websiteName: 'Test' } as any });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    saveSpy.mockRestore();
    getSpy.mockRestore();
  });
});

describe('Supabase engine — CRUD smoke tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getProducts calls supabase.from("products")', async () => {
    await dbService.getProducts().catch(() => {});
    expect(mockSupabaseClient.from).toHaveBeenCalledWith('products');
  });

  it('getOrders calls supabase.from("orders")', async () => {
    await dbService.getOrders().catch(() => {});
    expect(mockSupabaseClient.from).toHaveBeenCalledWith('orders');
  });

  it('getCoupons calls supabase.from("coupons")', async () => {
    await dbService.getCoupons().catch(() => {});
    expect(mockSupabaseClient.from).toHaveBeenCalledWith('coupons');
  });
});
