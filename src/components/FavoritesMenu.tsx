/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Product, ProductVariant } from '../types';
import { Plus, Star, AlertCircle, ShoppingCart, Clock, ExternalLink } from 'lucide-react';
import { useToast } from './Toast';
import { getVariantsForProducts } from '../db';

// ── localStorage helpers ──────────────────────────────────────────────────────
const RV_KEY = 'qf_recently_viewed';
const WL_KEY = 'qf_wishlist';

function getRecentlyViewed(): string[] {
  try { return JSON.parse(localStorage.getItem(RV_KEY) || '[]'); } catch { return []; }
}
function pushRecentlyViewed(id: string) {
  const prev = getRecentlyViewed().filter(x => x !== id);
  const next = [id, ...prev].slice(0, 6);
  try { localStorage.setItem(RV_KEY, JSON.stringify(next)); } catch {}
}
function getWishlist(): string[] {
  try { return JSON.parse(localStorage.getItem(WL_KEY) || '[]') as string[]; } catch { return []; }
}
function saveWishlist(ids: string[]) {
  try { localStorage.setItem(WL_KEY, JSON.stringify(ids)); } catch {}
}

interface FavoritesMenuProps {
  searchQuery: string;
  activeCategory: string | null;
  setActiveCategory: (category: string | null) => void;
}

export const FavoritesMenu = ({
  searchQuery,
  activeCategory,
  setActiveCategory,
}: FavoritesMenuProps) => {
  const { products, categories, reviews, addReview, addToCart, orders, currentUserEmail, siteSettings, formatPrice } = useApp();
  const visibleCategories = categories.filter(c => c.isVisible !== false);
  const navPinned = visibleCategories.filter(c => c.isNavbarFeatured === true);
  const displayCategories = navPinned.length > 0 ? navPinned : visibleCategories;
  const toast = useToast();

  const [reviewingProduct, setReviewingProduct] = useState<Product | null>(null);
  const [revName, setRevName] = useState('');
  const [revRating, setRevRating] = useState(5);
  const [revComment, setRevComment] = useState('');

  // TASK 7: recently viewed IDs (persistent)
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<string[]>(() => getRecentlyViewed());

  // TASK 8: wishlist Set with localStorage persistence
  const [wishlist, setWishlist] = useState<Set<string>>(() => new Set(getWishlist()));
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(null);

  // ── Quick Purchase: variant map (productId → variants[]) ──────────────────
  const [variantsMap, setVariantsMap] = useState<Map<string, ProductVariant[]>>(new Map());
  // Selected variant options per product card: productId → { groupName → variantValue }
  const [selectedVariantsMap, setSelectedVariantsMap] = useState<Record<string, Record<string, string>>>({});
  // Quantity per product card
  const [productQtyMap, setProductQtyMap] = useState<Record<string, number>>({});

  useEffect(() => {
    const activeIds = products.filter(p => p.isActive).map(p => p.id);
    if (activeIds.length === 0) return;
    let cancelled = false;
    getVariantsForProducts(activeIds).then(map => {
      if (cancelled) return;
      setVariantsMap(map);
      // Set defaults: for each product, for each variant group, pick first option
      const defaults: Record<string, Record<string, string>> = {};
      map.forEach((variants, productId) => {
        const groups = Array.from(new Set(variants.map(v => v.groupName)));
        if (groups.length > 0) {
          defaults[productId] = {};
          groups.forEach(g => {
            const first = variants.find(v => v.groupName === g);
            if (first) defaults[productId][g] = first.variantValue;
          });
        }
      });
      setSelectedVariantsMap(defaults);
    });
    return () => { cancelled = true; };
  }, [products]);

  const toSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const navigateToProduct = (prod: Product) => {
    handleTrackView(prod);
    const slug = toSlug(prod.name);
    window.history.pushState({}, '', `/product/${slug}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTrackView = (prod: Product) => {
    pushRecentlyViewed(prod.id);
    setRecentlyViewedIds(getRecentlyViewed());
  };

  const toggleWishlist = (productId: string) => {
    setWishlist(prev => {
      const next = new Set(prev);
      if (next.has(productId)) { next.delete(productId); } else { next.add(productId); }
      saveWishlist(Array.from(next) as string[]);
      return next;
    });
  };

  const scrollToProduct = (productId: string) => {
    const el = document.getElementById(`product-card-${productId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedProductId(productId);
      setTimeout(() => setHighlightedProductId(null), 2000);
    }
  };

  // Products this user has ordered (by email stored after checkout)
  const userOrderedProductIds = currentUserEmail
    ? new Set(
        orders
          .filter(o => o.email.trim().toLowerCase() === currentUserEmail)
          .flatMap(o => o.items.map(i => i.productId))
      )
    : new Set<string>();

  // Check if user already reviewed a product
  const userReviewedProductIds = currentUserEmail
    ? new Set(
        reviews
          .filter(r => orders.some(o => o.email.trim().toLowerCase() === currentUserEmail && o.items.some(i => i.productId === r.productId)))
          .map(r => r.productId)
      )
    : new Set<string>();

  // Filtering products
  const filteredProducts = products.filter((prod) => {
    if (!prod.isActive) return false;
    
    const matchesCategory = activeCategory
      ? prod.category.toLowerCase().trim() === activeCategory.toLowerCase().trim()
      : true;

    const matchesSearch = searchQuery
      ? prod.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        prod.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        prod.category.toLowerCase().includes(searchQuery.toLowerCase())
      : true;

    return matchesCategory && matchesSearch;
  });

  const handleOpenReview = (prod: Product) => {
    setReviewingProduct(prod);
    // Pre-fill name from existing order
    const userOrder = currentUserEmail
      ? orders.find(o => o.email.trim().toLowerCase() === currentUserEmail && o.items.some(i => i.productId === prod.id))
      : null;
    setRevName(userOrder?.customerName || '');
    setRevRating(5);
    setRevComment('');
  };

  const handleReviewSubmission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewingProduct) return;

    if (!currentUserEmail) {
      toast.error('Please complete a purchase first to leave a review.');
      return;
    }

    const hasOrdered = userOrderedProductIds.has(reviewingProduct.id);
    if (!hasOrdered) {
      toast.error(`Only verified buyers of "${reviewingProduct.name}" can submit a review.`);
      return;
    }

    try {
      await addReview(reviewingProduct.id, revName, revRating, revComment);
      toast.success(`🎉 Review submitted for ${reviewingProduct.name}!`);
      setReviewingProduct(null);
    } catch (err) {
      toast.error('Could not post your review, please try again.');
    }
  };

  return (
    <section className="py-16 px-6 sm:px-8 font-sans bg-white border-b border-slate-100" id="menu">
      <div className="max-w-7xl mx-auto">
        
        {/* Section Heading closely matching retro uploaded mockup */}
        <div className="text-center mb-10 relative select-none">
          <div className="text-emerald-600 text-xs sm:text-sm font-semibold tracking-widest uppercase mb-2">
            FRESH FROM THE KITCHENS
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight uppercase">
            All time Favorites
          </h2>
          <div className="h-1 w-20 bg-emerald-500 mx-auto mt-3 rounded-full"></div>
        </div>

        {/* Dynamic Category Buttons Filter bar */}
        <div className="flex flex-wrap justify-center items-center gap-3 mb-10 w-full" id="category-filters-container">
          <button
            onClick={() => setActiveCategory(null)}
            className={`cursor-pointer px-5 py-2 rounded-full font-sans font-bold uppercase text-xs sm:text-sm border transition-all shadow-sm ${
              activeCategory === null
                ? 'bg-emerald-100 text-emerald-800 border-emerald-300 shadow-sm'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:translate-y-[-1px]'
            }`}
          >
            🛍️ All Items ({products.filter(p => p.isActive).length})
          </button>
          {displayCategories.map((cat) => {
            const prodCount = products.filter((p) => p.category.toLowerCase().trim() === cat.name.toLowerCase().trim() && p.isActive).length;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.name)}
                className={`cursor-pointer flex items-center gap-2 px-5 py-2 rounded-full font-sans font-bold uppercase text-xs sm:text-sm border transition-all shadow-sm ${
                  activeCategory === cat.name
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300 shadow-sm'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:translate-y-[-1px]'
                }`}
              >
                {cat.imageUrl ? (
                  <img src={cat.imageUrl} alt={cat.name} className="w-5 h-5 object-contain rounded" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <span>{cat.emoji}</span>
                )}
                <span>{cat.name} ({prodCount})</span>
              </button>
            );
          })}
        </div>

        {/* Grid List */}
        {filteredProducts.length === 0 ? (
          <div className="bg-slate-50 border border-slate-200 p-12 text-center rounded-2xl max-w-lg mx-auto shadow-xs">
            <AlertCircle className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-800">No items match your criteria!</h3>
            <p className="text-slate-500 font-medium text-xs mt-1.5 leading-relaxed">Try tweaking filters or reset search query to inspect other products.</p>
            <button
              onClick={() => {
                setActiveCategory(null);
                toast.info('Search filters reset!');
              }}
              className="mt-4 cursor-pointer text-xs font-semibold uppercase px-4 py-2 border border-slate-200 bg-white shadow-xs hover:bg-slate-50 rounded-full text-slate-700"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6" id="product-grid">
            {filteredProducts.map((prod) => {
              const isLowStock = prod.stock > 0 && prod.stock <= 5;
              const isOutOfStock = prod.stock <= 0;
              const hasDiscount = prod.salePrice !== null;
              const displayPrice = hasDiscount ? prod.salePrice : prod.price;

              return (
                <div
                  key={prod.id}
                  className={`bg-white border rounded-2xl p-4 flex flex-col justify-between transition-all duration-200 hover:translate-y-[-2px] hover:shadow-md shadow-sm relative group ${
                    highlightedProductId === prod.id
                      ? 'border-emerald-400 ring-2 ring-emerald-300 shadow-emerald-100'
                      : 'border-slate-100 hover:border-slate-200/80'
                  }`}
                  id={`product-card-${prod.id}`}
                  onMouseEnter={() => handleTrackView(prod)}
                >
                  {/* Sale Badge */}
                  {hasDiscount && (
                    <div className="absolute top-3 left-3 bg-orange-500 text-white text-[9px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded shadow-sm z-10">
                      SALE!
                    </div>
                  )}

                  {/* Rating Stars score */}
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-4">
                    <span className="bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-lg text-slate-800 flex items-center gap-1 shadow-sm">
                      <Star className="w-3.5 h-3.5 fill-amber-400 stroke-amber-500" />
                      <span>{prod.rating || 'New'}</span>
                      <span className="text-[10px] text-slate-400 font-medium">({prod.reviewsCount || 0})</span>
                    </span>
                    <span className="text-[10px] text-slate-500 font-sans tracking-tight uppercase bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                      {prod.category}
                    </span>
                  </div>

                  {/* Product Image / Emoji container — prefers coverImage over image */}
                  {(() => {
                    // Use selected variant image if available, otherwise fall back to cover image
                    const prodVariants = variantsMap.get(prod.id) || [];
                    const selectedForProd = selectedVariantsMap[prod.id] || {};
                    const selectedVariantObj = prodVariants.find(v =>
                      Object.entries(selectedForProd).some(([g, val]) => v.groupName === g && v.variantValue === val && v.imageUrl)
                    );
                    const imgSrc = selectedVariantObj?.imageUrl || prod.coverImage || prod.image;
                    if (imgSrc && (imgSrc.startsWith('http') || imgSrc.startsWith('data:') || imgSrc.startsWith('/'))) {
                      return (
                        <div className="w-full aspect-square bg-white rounded-xl flex items-center justify-center relative mb-4 overflow-hidden select-none border border-slate-100 shadow-sm cursor-pointer group/imglink" onClick={() => navigateToProduct(prod)} title={`View ${prod.name}`}>
                          <img
                            src={imgSrc}
                            alt={prod.name}
                            className="w-full h-full object-contain p-3 transform group-hover:scale-105 transition-all duration-300"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        </div>
                      );
                    }
                    return (
                      <div className="w-full aspect-square bg-slate-50 rounded-xl flex items-center justify-center relative mb-4 overflow-hidden select-none group-hover:bg-slate-100 transition-colors border border-slate-100">
                        <div className="text-6xl transform group-hover:scale-110 transition-all duration-300">
                          {imgSrc || '🍎'}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Title and Description */}
                  <div className="flex-1 mb-4">
                    <h3
                      className="text-sm font-bold font-sans text-slate-800 line-clamp-2 uppercase cursor-pointer hover:text-emerald-700 transition-colors"
                      onClick={() => navigateToProduct(prod)}
                      title={`View ${prod.name}`}
                    >{prod.name}</h3>
                    <p className="text-xs text-slate-500 font-normal line-clamp-3 mt-1 leading-snug">
                      {prod.description}
                    </p>
                    
                    {/* Ingredients indicators */}
                    {prod.ingredients && prod.ingredients.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2.5">
                        {prod.ingredients.slice(0, 3).map((ing, idx) => (
                          <span key={idx} className="bg-slate-100 text-slate-500 border border-slate-200 text-[8px] font-sans font-medium px-1.5 py-0.5 rounded uppercase">
                            {ing}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Stock & Add Cart interface */}
                  <div className="mt-auto pt-3 border-t border-slate-100">

                    {/* ── Quick Purchase: compact variant selectors ────────── */}
                    {(() => {
                      const prodVariants = variantsMap.get(prod.id) || [];
                      const groups = Array.from(new Set(prodVariants.map(v => v.groupName)));
                      if (groups.length === 0) return null;
                      const selectedForProd = selectedVariantsMap[prod.id] || {};
                      return (
                        <div className="mb-3 space-y-2">
                          {groups.map(groupName => {
                            const gn = groupName as string;
                            const options = prodVariants.filter(v => v.groupName === gn);
                            return (
                              <div key={gn}>
                                <span className="text-[9px] font-bold uppercase text-slate-500 tracking-wider">{gn}:</span>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {options.map(opt => (
                                    <button
                                      key={opt.id}
                                      onClick={() => setSelectedVariantsMap(prev => ({
                                        ...prev,
                                        [prod.id]: { ...(prev[prod.id] || {}), [gn]: opt.variantValue },
                                      }))}
                                      disabled={opt.stock <= 0}
                                      className={`px-2 py-0.5 rounded-lg border text-[10px] font-semibold cursor-pointer transition-all ${
                                        selectedForProd[gn] === opt.variantValue
                                          ? 'bg-emerald-500 text-white border-transparent'
                                          : opt.stock <= 0
                                            ? 'bg-slate-100 text-slate-400 border-slate-200 line-through cursor-not-allowed'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-400'
                                      }`}
                                    >
                                      {opt.variantValue}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* Price + Quantity stepper on same row */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      {/* Pricing block — updates with variant selection */}
                      <div className="flex items-baseline gap-1.5">
                        {(() => {
                          const prodVariants = variantsMap.get(prod.id) || [];
                          const selectedForProd = selectedVariantsMap[prod.id] || {};
                          const groups = Array.from(new Set(prodVariants.map(v => v.groupName)));
                          if (groups.length > 0) {
                            const firstGroup = groups[0];
                            const selectedValue = selectedForProd[firstGroup];
                            const variantRow = selectedValue
                              ? prodVariants.find(v => v.groupName === firstGroup && v.variantValue === selectedValue)
                              : null;
                            if (variantRow) {
                              return (
                                <span className="text-lg font-sans font-bold text-slate-800">
                                  {formatPrice(variantRow.price)}
                                </span>
                              );
                            }
                          }
                          return (
                            <>
                              <span className="text-lg font-sans font-bold text-slate-800">
                                {formatPrice(displayPrice || 0)}
                              </span>
                              {hasDiscount && (
                                <span className="text-xs text-slate-400 line-through">
                                  {formatPrice(prod.price)}
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </div>

                      {/* Quantity stepper — inline with price */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setProductQtyMap(m => ({ ...m, [prod.id]: Math.max(1, (m[prod.id] || 1) - 1) }))}
                          disabled={isOutOfStock || (productQtyMap[prod.id] || 1) <= 1}
                          className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 text-slate-600 hover:bg-slate-200 disabled:opacity-40 transition-colors cursor-pointer font-bold text-base flex items-center justify-center"
                        >−</button>
                        <span className="text-sm font-bold text-slate-800 min-w-[1.25rem] text-center">{productQtyMap[prod.id] || 1}</span>
                        <button
                          type="button"
                          onClick={() => setProductQtyMap(m => ({ ...m, [prod.id]: Math.min(prod.stock, (m[prod.id] || 1) + 1) }))}
                          disabled={isOutOfStock || (productQtyMap[prod.id] || 1) >= prod.stock}
                          className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 text-slate-600 hover:bg-slate-200 disabled:opacity-40 transition-colors cursor-pointer font-bold text-base flex items-center justify-center"
                        >+</button>
                      </div>
                    </div>

                    {/* Stock badge */}
                    <div className="mb-1.5">
                      {isOutOfStock ? (
                        <span className="bg-red-100 text-red-600 border border-red-200 text-[9px] font-bold px-2 py-0.5 rounded-full select-none">
                          Out of Stock
                        </span>
                      ) : isLowStock ? (
                        <span className="bg-orange-50 text-orange-700 border border-orange-200 text-[9px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-0.5 animate-pulse select-none w-fit">
                          Only {prod.stock} left!
                        </span>
                      ) : (
                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] font-semibold px-2.5 py-0.5 rounded-full select-none">
                          ● {prod.stock} IN STOCK
                        </span>
                      )}
                    </div>

                    {/* Add to Cart row */}
                    <div className="flex flex-col gap-1.5">
                      <div className="grid grid-cols-12 gap-2">
                      <button
                        onClick={() => {
                          if (!isOutOfStock) {
                            // Resolve selected variant and pass to addToCart so it appears everywhere
                            const prodVariants = variantsMap.get(prod.id) || [];
                            const selectedForProd = selectedVariantsMap[prod.id] || {};
                            const groups = Array.from(new Set(prodVariants.map(v => v.groupName)));
                            let variantPrice: number | undefined;
                            let selectedVariants: Record<string, string> | undefined;
                            if (groups.length > 0) {
                              selectedVariants = { ...selectedForProd };
                              const firstGroup = groups[0];
                              const selectedValue = selectedForProd[firstGroup];
                              const variantRow = selectedValue
                                ? prodVariants.find(v => v.groupName === firstGroup && v.variantValue === selectedValue)
                                : null;
                              if (variantRow) variantPrice = variantRow.price;
                            }
                            const hasVariants = selectedVariants && Object.keys(selectedVariants).length > 0;
                            const qtyToAdd = productQtyMap[prod.id] || 1;
                            for (let i = 0; i < qtyToAdd; i++) {
                              addToCart(prod, hasVariants ? selectedVariants : undefined, variantPrice);
                            }
                            const variantSuffix = hasVariants ? ` (${Object.values(selectedVariants!).join(' / ')})` : '';
                            toast.success(`🛒 Added ${qtyToAdd}× ${prod.name}${variantSuffix} to checkout list.`);
                            // Reset qty to 1 after adding
                            setProductQtyMap(m => ({ ...m, [prod.id]: 1 }));
                          }
                        }}
                        disabled={isOutOfStock}
                        className={`${userOrderedProductIds.has(prod.id) ? 'col-span-8' : 'col-span-12'} flex items-center justify-center gap-1.5 cursor-pointer py-2 rounded-xl border font-sans font-semibold text-xs transition-all ${
                          isOutOfStock
                            ? 'bg-slate-100 text-slate-400 border-slate-200 shadow-none cursor-not-allowed'
                            : 'bg-emerald-500 hover:bg-emerald-600 border-transparent text-white shadow-xs hover:translate-y-[-0.5px]'
                        }`}
                        id={`add-to-cart-btn-${prod.id}`}
                      >
                        <ShoppingCart className="w-3.5 h-3.5" />
                        <span>Add To Cart</span>
                      </button>

                      {userOrderedProductIds.has(prod.id) && (
                        userReviewedProductIds.has(prod.id) ? (
                          <div className="col-span-4 py-2 border border-emerald-200 bg-emerald-50 font-sans font-semibold text-xs text-center rounded-xl text-emerald-600 select-none">
                            ✅ Reviewed
                          </div>
                        ) : (
                          <button
                            onClick={() => handleOpenReview(prod)}
                            className="col-span-4 py-2 border border-amber-200 bg-amber-50 font-sans font-semibold text-xs text-center cursor-pointer uppercase rounded-xl hover:bg-amber-100 transition-all text-amber-700 shadow-xs hover:translate-y-[-0.5px]"
                            title="Write a review for your purchase"
                          >
                            ⭐ Review
                          </button>
                        )
                      )}
                    </div>
                    </div>{/* end flex flex-col */}

                    

                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* TASK 7 — RECENTLY VIEWED STRIP */}
        {recentlyViewedIds.length > 0 && (() => {
          const recentProducts = recentlyViewedIds
            .map(id => products.find(p => p.id === id && p.isActive))
            .filter(Boolean) as Product[];
          if (recentProducts.length === 0) return null;
          return (
            <div className="mt-14">
              <div className="flex items-center gap-2.5 mb-5">
                <Clock className="w-5 h-5 text-slate-400" />
                <h3 className="text-base font-extrabold uppercase tracking-tight text-slate-700">Recently Viewed</h3>
                <div className="flex-1 h-px bg-slate-100" />
              </div>
              <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory">
                {recentProducts.map(prod => {
                  const price = prod.salePrice ?? prod.price;
                  return (
                    <button
                      key={prod.id}
                      onClick={() => scrollToProduct(prod.id)}
                      className="snap-start flex-shrink-0 flex items-center gap-3 bg-white border border-slate-100 hover:border-emerald-300 rounded-xl p-3 shadow-xs transition-all hover:shadow-sm hover:translate-y-[-1px] cursor-pointer w-48"
                    >
                      <div className="w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0 border border-slate-100">
                        {prod.image && (prod.image.startsWith('http') || prod.image.startsWith('data:') || prod.image.startsWith('/')) ? (
                          <img src={prod.image} alt={prod.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        ) : (
                          <span className="text-xl">{prod.image || '🍎'}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-800 truncate uppercase leading-tight">{prod.name}</p>
                        <p className="text-xs font-semibold text-emerald-600 mt-0.5">{formatPrice(price)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* WRITE A REVIEW MODAL Popup overlay */}
        {reviewingProduct && (
          <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center bg-slate-900/60 p-4 font-sans max-h-screen">
            <div className="bg-white border border-slate-100 rounded-2xl p-6 max-w-md w-full shadow-xl animate-bounce-subtle">
              <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
                <h3 className="text-md font-bold text-slate-800 uppercase">Write a Review</h3>
                {reviewingProduct.image && (reviewingProduct.image.startsWith('http') || reviewingProduct.image.startsWith('data:') || reviewingProduct.image.startsWith('/')) ? (
                  <img src={reviewingProduct.image} alt={reviewingProduct.name} className="w-10 h-10 object-cover rounded-lg border border-slate-100" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <span className="text-xl bg-slate-50 p-1.5 rounded-lg border border-slate-100">{reviewingProduct.image}</span>
                )}
              </div>
              
              <p className="text-xs text-slate-400 font-bold mb-4">
                Reviewing: <span className="text-slate-800 font-extrabold">{reviewingProduct.name}</span>
              </p>

              <form onSubmit={handleReviewSubmission} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">Your Name *</label>
                  <input
                    type="text"
                    required
                    value={revName}
                    onChange={(e) => setRevName(e.target.value)}
                    placeholder="Enter your display name (e.g. David K.)"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 focus:bg-white outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>

                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                  <span className="text-emerald-600 text-sm">✅</span>
                  <p className="text-[11px] text-emerald-700 font-semibold">
                    Verified purchase — you ordered this product.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">Overall Rating *</label>
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 4, 5].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setRevRating(num)}
                        className="p-1 hover:scale-110 transition-transform cursor-pointer"
                      >
                        <Star
                          className={`w-6 h-6 ${
                            num <= revRating
                              ? 'fill-amber-400 text-amber-500'
                              : 'text-slate-200'
                          }`}
                        />
                      </button>
                    ))}
                    <span className="ml-1 text-xs font-bold text-slate-400">({revRating}/5)</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">Your Review *</label>
                  <textarea
                    required
                    rows={3}
                    value={revComment}
                    onChange={(e) => setRevComment(e.target.value)}
                    placeholder="What did you like about this recipe?"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-800 focus:bg-white outline-none focus:ring-2 focus:ring-emerald-400 resize-none"
                  ></textarea>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setReviewingProduct(null)}
                    className="px-4 py-2 border border-slate-200 rounded-full text-xs font-semibold uppercase hover:bg-slate-50 cursor-pointer text-slate-600"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full text-xs font-semibold uppercase hover:shadow-sm cursor-pointer"
                  >
                    Submit Review
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </section>
  );
};
