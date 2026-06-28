/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Fruitopia — Firestore Real-Time Service Layer
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * REFACTORED: All direct 'firebase/firestore' imports have been removed.
 * Every operation now delegates to the `dbService` abstraction in db.ts, which
 * is the single authorised Firebase driver layer.  This makes all functions
 * engine-agnostic — they work identically whether the active backend is
 * Firebase, Supabase, or the local mock.
 *
 * Public API is preserved unchanged so existing call-sites continue to work.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { dbService, subscribeCoupons, subscribeCategories, subscribeSiteSettings } from './db';
import { fileToBase64 as _fileToBase64Compressed } from './firebase';
import { SiteSettings, Coupon, Category } from './types';

// ═════════════════════════════════════════════════════════════════════════════
// STORE CONFIG (Global Settings + Currency)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * StoreConfig interface — wraps the SiteSettings document
 */
export interface StoreConfig {
  storeCurrency: string;
  currencySymbol: string;
  currencyPosition?: 'before' | 'after';
  storeName: string;
  storeLogo: string;
  lastUpdatedAt?: number;
}

/**
 * Initialize or update the store config document via dbService.saveSiteSettings.
 */
export async function saveStoreConfig(config: Partial<StoreConfig>): Promise<void> {
  try {
    const existing = await dbService.getSiteSettings();
    await dbService.saveSiteSettings({
      ...existing,
      ...(config.storeName      !== undefined ? { websiteName: config.storeName, siteTitle: config.storeName }                          : {}),
      ...(config.storeLogo      !== undefined ? { logoUrl: config.storeLogo }                                                            : {}),
      ...(config.storeCurrency  !== undefined ? { currency: config.storeCurrency }                                                       : {}),
      ...(config.currencySymbol !== undefined ? { currencySymbol: config.currencySymbol }                                                : {}),
      ...(config.currencyPosition !== undefined ? { currencyPosition: config.currencyPosition }                                          : {}),
    } as SiteSettings);
  } catch (e) {
    console.warn('[firestore-service] saveStoreConfig error:', e);
    throw e;
  }
}

/**
 * Fetch the current store config from the active backend (one-time read).
 */
export async function getStoreConfig(): Promise<StoreConfig | null> {
  try {
    const site = await dbService.getSiteSettings();
    if (!site) return null;
    return {
      storeCurrency:    (site as any).currency         ?? 'USD',
      currencySymbol:   (site as any).currencySymbol   ?? '$',
      currencyPosition: (site as any).currencyPosition ?? 'before',
      storeName:        (site as any).websiteName      ?? (site as any).siteTitle ?? 'Fruitopia',
      storeLogo:        (site as any).logoUrl          ?? '',
      lastUpdatedAt:    Date.now(),
    };
  } catch (e) {
    console.warn('[firestore-service] getStoreConfig error:', e);
    return null;
  }
}

/**
 * Subscribe to real-time updates of the store config.
 * Delegates to db.ts subscribeSiteSettings.
 */
export function onStoreConfigChange(callback: (config: StoreConfig | null) => void): () => void {
  return subscribeSiteSettings((site) => {
    if (!site) { callback(null); return; }
    callback({
      storeCurrency:    (site as any).currency         ?? 'USD',
      currencySymbol:   (site as any).currencySymbol   ?? '$',
      currencyPosition: (site as any).currencyPosition ?? 'before',
      storeName:        (site as any).websiteName      ?? (site as any).siteTitle ?? 'Fruitopia',
      storeLogo:        (site as any).logoUrl          ?? '',
      lastUpdatedAt:    Date.now(),
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// COUPONS COLLECTION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Create or update a coupon via dbService.saveCoupon.
 */
export async function saveCoupon(coupon: Coupon): Promise<void> {
  try {
    const couponId = coupon.id || `coup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await dbService.saveCoupon({ ...coupon, id: couponId });
  } catch (e) {
    console.warn('[firestore-service] saveCoupon error:', e);
    throw e;
  }
}

/**
 * Delete a coupon via dbService.deleteCoupon.
 */
export async function deleteCoupon(couponId: string): Promise<void> {
  try {
    await dbService.deleteCoupon(couponId);
  } catch (e) {
    console.warn('[firestore-service] deleteCoupon error:', e);
    throw e;
  }
}

/**
 * Fetch all coupons via dbService.getCoupons (one-time read).
 */
export async function getAllCoupons(): Promise<Coupon[]> {
  try {
    return await dbService.getCoupons();
  } catch (e) {
    console.warn('[firestore-service] getAllCoupons error:', e);
    return [];
  }
}

/**
 * Subscribe to real-time coupon updates.
 * Delegates to db.ts subscribeCoupons.
 */
export function onCouponsChange(callback: (coupons: Coupon[]) => void): () => void {
  return subscribeCoupons(callback);
}

/**
 * Validate a coupon code against the active backend collection.
 * Returns the coupon object if valid and active, null otherwise.
 */
export async function validateCouponCode(code: string): Promise<Coupon | null> {
  try {
    const coupons = await dbService.getCoupons();
    const normalised = code.toUpperCase().trim();
    const coupon = coupons.find((c) => c.code === normalised);
    if (!coupon) return null;
    if (coupon.expiryDate) {
      const expiry = new Date(coupon.expiryDate).getTime();
      if (expiry < Date.now()) return null;
    }
    if (!coupon.isActive) return null;
    return coupon;
  } catch (e) {
    console.warn('[firestore-service] validateCouponCode error:', e);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CATEGORIES COLLECTION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Create or update a category via dbService.saveCategory.
 */
export async function saveCategory(category: Category): Promise<void> {
  try {
    const catId = category.id || `cat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await dbService.saveCategory({ ...category, id: catId });
  } catch (e) {
    console.warn('[firestore-service] saveCategory error:', e);
    throw e;
  }
}

/**
 * Delete a category via dbService.deleteCategory.
 */
export async function deleteCategory(categoryId: string): Promise<void> {
  try {
    await dbService.deleteCategory(categoryId);
  } catch (e) {
    console.warn('[firestore-service] deleteCategory error:', e);
    throw e;
  }
}

/**
 * Fetch all categories via dbService.getCategories (one-time read).
 */
export async function getAllCategories(): Promise<Category[]> {
  try {
    return await dbService.getCategories();
  } catch (e) {
    console.warn('[firestore-service] getAllCategories error:', e);
    return [];
  }
}

/**
 * Subscribe to real-time category updates.
 * Delegates to db.ts subscribeCategories.
 */
export function onCategoriesChange(callback: (categories: Category[]) => void): () => void {
  return subscribeCategories(callback);
}

// ═════════════════════════════════════════════════════════════════════════════
// UTILITY: FILE TO BASE64 CONVERSION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Convert a File object to a Base64 data URI string.
 */
export function fileToBase64(file: File): Promise<string> {
  return _fileToBase64Compressed(file);
}

/**
 * Validate image file before Base64 encoding.
 */
export function validateImageFile(
  file: File,
  maxSizeMB: number = 2
): { valid: boolean; error?: string } {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: 'Unsupported file type. Use JPG, PNG, WebP, GIF, or SVG.' };
  }

  if (file.size > maxSizeMB * 1024 * 1024) {
    return {
      valid: false,
      error: `Image too large. Maximum size is ${maxSizeMB}MB.`,
    };
  }

  return { valid: true };
}

export default {
  saveStoreConfig,
  getStoreConfig,
  onStoreConfigChange,
  saveCoupon,
  deleteCoupon,
  getAllCoupons,
  onCouponsChange,
  validateCouponCode,
  saveCategory,
  deleteCategory,
  getAllCategories,
  onCategoriesChange,
  fileToBase64,
  validateImageFile,
};
