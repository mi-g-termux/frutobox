/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Fruitopia — ProductDetailPage.tsx  (Section 3: Gallery + Variants)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This page shows:
 *  - Full-size product images (gallery with thumbnails)
 *  - Variant selectors (dropdowns per variant group, e.g. Size, Color)
 *  - Price / stock updated live when variants change
 *  - Add to Cart
 *  - Product description and ingredient tags
 *  - Reviews section
 *  - Related products strip
 *
 * Access via URL: /product/:id
 * Product cards link here via a "View Details" anchor.
 * Gallery images are NEVER shown on homepage cards — only here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from './Toast';
import {
  getProductImages,
  getProductVariantGroups,
  getProductVariants,
} from '../db';
import type { ProductImage, ProductVariantGroup, ProductVariant } from '../types';
import { Star, ShoppingCart, ChevronLeft, Package } from 'lucide-react';

interface ProductDetailPageProps {
  productId: string;
}

export function ProductDetailPage({ productId }: ProductDetailPageProps) {
  const { products, reviews, addToCart, formatPrice, siteSettings } = useApp();
  const toast = useToast();

  const toSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const product = products.find(p => p.id === productId || toSlug(p.name) === productId);

  // ── Gallery state ──────────────────────────────────────────────────────────
  const [images, setImages]     = useState<ProductImage[]>([]);
  const [activeImg, setActiveImg] = useState(0);

  // ── Variant state ──────────────────────────────────────────────────────────
  const [variantGroups, setVariantGroups] = useState<ProductVariantGroup[]>([]);
  const [variants, setVariants]           = useState<ProductVariant[]>([]);
  const [selected, setSelected]           = useState<Record<string, string>>({});
  const [qty, setQty]                       = useState(1);

  // ── Load data ──────────────────────────────────────────────────────────────
  // Scroll to top whenever the product changes.
  // ROOT CAUSE of scroll-to-bottom bug: pushState-based navigation (used by this
  // SPA) preserves the scroll position from the previous page. useEffect fires
  // AFTER the browser has already painted, meaning the user briefly sees the
  // old scroll position before the reset. useLayoutEffect fires synchronously
  // after DOM mutations but BEFORE the browser paints, eliminating the flash.
  // Assigning both scrollTo and the raw scrollTop properties covers all browsers.
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [productId]);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;

    async function load() {
      const realId = products.find(p => p.id === productId || toSlug(p.name) === productId)?.id ?? productId;
      const [imgs, groups, vars] = await Promise.all([
        getProductImages(realId),
        getProductVariantGroups(realId),
        getProductVariants(realId),
      ]);
      if (cancelled) return;
      setImages(imgs);
      setVariantGroups(groups);
      setVariants(vars);
      // Default: select the first option in each group
      const defaults: Record<string, string> = {};
      groups.forEach(g => {
        const first = vars.find(v => v.groupName === g.groupName);
        if (first) defaults[g.groupName] = first.variantValue;
      });
      setSelected(defaults);
    }

    load();
    return () => { cancelled = true; };
  }, [productId]);

  // ── Computed: resolved variant (price/stock) ───────────────────────────────
  const resolvedVariant = useCallback((): ProductVariant | null => {
    if (variantGroups.length === 0) return null;
    const selectedValues = Object.values(selected);
    // Find the variant that matches all selected options
    // (For multi-group products, find the intersection)
    const match = variants.find(v => {
      if (variantGroups.length === 1) {
        return v.groupName === variantGroups[0].groupName && v.variantValue === selected[variantGroups[0].groupName];
      }
      // Multi-group: find the variant whose groupName+variantValue matches first selected group
      // Variants encode a combo in a flat list, each variant row belongs to ONE group
      return v.groupName === Object.keys(selected)[0] && v.variantValue === Object.values(selected)[0];
    });
    return match || null;
  }, [variants, variantGroups, selected]);

  if (!product) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-700">Product not found</h2>
          <p className="text-slate-400 text-sm mt-1">This product may have been removed or doesn't exist.</p>
          <button
            onClick={() => window.history.back()}
            className="mt-4 px-4 py-2 bg-emerald-500 text-white rounded-xl text-sm font-semibold hover:bg-emerald-600 transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const resolved         = resolvedVariant();
  const effectivePrice   = resolved?.price ?? (product.salePrice ?? product.price);
  const effectiveStock   = resolved?.stock ?? product.stock;
  const isOutOfStock     = effectiveStock <= 0;
  const isLowStock       = effectiveStock > 0 && effectiveStock <= 5;
  const hasDiscount      = product.salePrice !== null && !resolved;
  const coverSrc         = product.coverImage || product.image;

  // Build display images: cover + gallery thumbnails
  const allImages: string[] = [];
  if (coverSrc && (coverSrc.startsWith('http') || coverSrc.startsWith('data:') || coverSrc.startsWith('/'))) {
    allImages.push(coverSrc);
  }
  images.forEach(img => { if (!allImages.includes(img.imageUrl)) allImages.push(img.imageUrl); });
  if (resolved?.imageUrl && !allImages.includes(resolved.imageUrl)) {
    allImages.unshift(resolved.imageUrl); // Variant image first
  }

  const productReviews = reviews.filter(r => r.productId === productId);

  // Related products: same category, excluding current
  const related = products.filter(p => p.isActive && p.id !== productId && p.category === product.category).slice(0, 4);

  const handleAddToCart = () => {
    if (isOutOfStock) return;
    // Pass the base product plus the selected variant info separately
    // so the cart can show and save which variant was chosen
    for (let i = 0; i < qty; i++) {
      addToCart(product, Object.keys(selected).length > 0 ? selected : undefined, resolved?.price);
    }
    toast.success(`🛒 Added ${qty}× ${product.name} to cart!`);
  };

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {/* Breadcrumb */}
      <div className="bg-white border-b border-slate-100 px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center gap-2 text-xs font-medium text-slate-500">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1 hover:text-emerald-600 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Home
          </button>
          <span>/</span>
          <span className="text-slate-400">{product.category}</span>
          <span>/</span>
          <span className="text-slate-700 font-semibold">{product.name}</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">

          {/* ── LEFT: Image Gallery ───────────────────────────────────────── */}
          <div>
            {/* Main image */}
            <div className="w-full aspect-square bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex items-center justify-center mb-4 relative">
              {allImages.length > 0 ? (
                <img
                  src={allImages[activeImg] || allImages[0]}
                  alt={product.name}
                  className="w-full h-full object-contain p-6 transition-opacity duration-200"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="text-8xl select-none">{product.image || '🍎'}</div>
              )}
              {/* Discount badge */}
              {hasDiscount && (
                <div className="absolute top-4 left-4 bg-orange-500 text-white text-xs font-bold uppercase px-3 py-1 rounded-full shadow">
                  SALE!
                </div>
              )}
            </div>

            {/* Thumbnail strip — only shown when there are multiple images */}
            {allImages.length > 1 && (
              <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
                {allImages.map((src, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveImg(idx)}
                    className={`w-16 h-16 flex-shrink-0 rounded-xl border-2 overflow-hidden transition-all bg-white cursor-pointer ${
                      activeImg === idx
                        ? 'border-emerald-500 shadow-md'
                        : 'border-slate-100 hover:border-slate-300'
                    }`}
                  >
                    <img
                      src={src}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── RIGHT: Product Info + Variant Selectors ───────────────────── */}
          <div className="space-y-5">
            {/* Category + Rating */}
            <div className="flex items-center gap-3">
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold px-3 py-1 rounded-full uppercase">
                {product.category}
              </span>
              <span className="flex items-center gap-1 text-xs font-semibold text-slate-600">
                <Star className="w-3.5 h-3.5 fill-amber-400 stroke-amber-500" />
                {product.rating || 'New'} ({product.reviewsCount || 0} reviews)
              </span>
            </div>

            {/* Title */}
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 uppercase leading-tight">
              {product.name}
            </h1>

            {/* Pricing + Quantity stepper on same row */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-extrabold text-slate-900">
                  {formatPrice(effectivePrice || 0)}
                </span>
                {hasDiscount && (
                  <span className="text-lg text-slate-400 line-through">
                    {formatPrice(product.price)}
                  </span>
                )}
                {isOutOfStock ? (
                  <span className="bg-red-100 text-red-600 border border-red-200 text-xs font-bold px-2.5 py-1 rounded-full">
                    Out of Stock
                  </span>
                ) : isLowStock ? (
                  <span className="bg-orange-50 text-orange-700 border border-orange-200 text-xs font-bold px-2.5 py-1 rounded-full animate-pulse">
                    Only {effectiveStock} left!
                  </span>
                ) : (
                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold px-2.5 py-1 rounded-full">
                    ● {effectiveStock} in stock
                  </span>
                )}
              </div>
              {/* Quantity stepper — inline with price */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setQty(q => Math.max(1, q - 1))}
                  disabled={isOutOfStock || qty <= 1}
                  className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 text-slate-600 hover:bg-slate-200 disabled:opacity-40 transition-colors cursor-pointer flex items-center justify-center"
                >
                  <span className="text-lg font-bold leading-none">−</span>
                </button>
                <span className="text-sm font-bold text-slate-800 min-w-[1.5rem] text-center">{qty}</span>
                <button
                  type="button"
                  onClick={() => setQty(q => Math.min(effectiveStock, q + 1))}
                  disabled={isOutOfStock || qty >= effectiveStock}
                  className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 text-slate-600 hover:bg-slate-200 disabled:opacity-40 transition-colors cursor-pointer flex items-center justify-center"
                >
                  <span className="text-lg font-bold leading-none">+</span>
                </button>
              </div>
            </div>

            {/* ── Variant Selectors ─────────────────────────────────────── */}
            {variantGroups.length > 0 && (
              <div className="space-y-4 border border-slate-100 bg-slate-50 rounded-2xl p-4">
                {variantGroups.map(group => {
                  const options = variants.filter(v => v.groupName === group.groupName);
                  if (options.length === 0) return null;
                  return (
                    <div key={group.id}>
                      <label className="block text-xs font-bold uppercase text-slate-600 mb-2 tracking-wider">
                        {group.groupName}
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {options.map(opt => (
                          <button
                            key={opt.id}
                            onClick={() => { setSelected(prev => ({ ...prev, [group.groupName]: opt.variantValue })); setActiveImg(0); }}
                            disabled={opt.stock <= 0}
                            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                              selected[group.groupName] === opt.variantValue
                                ? 'bg-emerald-500 text-white border-transparent shadow-sm'
                                : opt.stock <= 0
                                  ? 'bg-slate-100 text-slate-400 border-slate-200 line-through cursor-not-allowed'
                                  : 'bg-white text-slate-700 border-slate-200 hover:border-emerald-400 hover:text-emerald-700'
                            }`}
                          >
                            {opt.variantValue}
                            {opt.price !== product.price && (
                              <span className="ml-1 text-[10px] opacity-75">
                                ({formatPrice(opt.price)})
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add to Cart — full width */}
            <div>
              <button
                onClick={handleAddToCart}
                disabled={isOutOfStock}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-sans font-bold text-sm transition-all ${
                  isOutOfStock
                    ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                    : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm hover:translate-y-[-1px] hover:shadow-md'
                }`}
              >
                <ShoppingCart className="w-4 h-4" />
                {isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
              </button>
            </div>

            {/* Description */}
            <div>
              <h2 className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-2">Description</h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                {product.description}
              </p>
            </div>

            {/* Ingredients */}
            {product.ingredients && product.ingredients.length > 0 && (
              <div>
                <h2 className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-2">
                  {siteSettings?.ingredientLabel || 'Ingredients'}
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {product.ingredients.map((ing, idx) => (
                    <span
                      key={idx}
                      className="bg-emerald-50 text-emerald-700 border border-emerald-100 text-xs font-medium px-2.5 py-1 rounded-full"
                    >
                      {ing}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Reviews ────────────────────────────────────────────────────────── */}
        {productReviews.length > 0 && (
          <div className="mt-14">
            <div className="flex items-center gap-2 mb-6">
              <h2 className="text-xl font-extrabold uppercase text-slate-800 tracking-tight">Customer Reviews</h2>
              <div className="flex-1 h-px bg-slate-100" />
              <span className="text-sm text-slate-500 font-semibold">{productReviews.length} review{productReviews.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {productReviews.map(rev => (
                <div key={rev.id} className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-bold text-slate-800 text-sm">{rev.customerName}</p>
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`w-3.5 h-3.5 ${i < rev.rating ? 'fill-amber-400 stroke-amber-500' : 'fill-slate-100 stroke-slate-300'}`}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-sm text-slate-500 leading-relaxed">{rev.comment}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Related Products ─────────────────────────────────────────────── */}
        {related.length > 0 && (
          <div className="mt-14">
            <div className="flex items-center gap-2 mb-6">
              <h2 className="text-xl font-extrabold uppercase text-slate-800 tracking-tight">More from {product.category}</h2>
              <div className="flex-1 h-px bg-slate-100" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {related.map(rel => {
                const relPrice = rel.salePrice ?? rel.price;
                const relCover = rel.coverImage || rel.image;
                return (
                  <button
                    key={rel.id}
                    onClick={() => { navigate(`/product/${toSlug(rel.name)}`); window.scrollTo({ top: 0, behavior: 'instant' }); }}
                    className="bg-white border border-slate-100 hover:border-emerald-300 rounded-2xl p-4 text-left transition-all hover:shadow-md hover:translate-y-[-2px] cursor-pointer group"
                  >
                    <div className="w-full aspect-square bg-slate-50 rounded-xl flex items-center justify-center mb-3 overflow-hidden">
                      {relCover && (relCover.startsWith('http') || relCover.startsWith('data:') || relCover.startsWith('/')) ? (
                        <img
                          src={relCover}
                          alt={rel.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <span className="text-4xl">{rel.image || '🍎'}</span>
                      )}
                    </div>
                    <p className="text-xs font-bold text-slate-800 uppercase line-clamp-2 mb-1">{rel.name}</p>
                    <p className="text-sm font-extrabold text-emerald-600">{formatPrice(relPrice)}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
