# Fruitopia — Database Abstraction Refactor Audit Report

**Date:** 2026-06-21  
**Scope:** Database-agnostic refactor — remove all direct Firebase/Firestore imports  
**Rule:** Only `src/db.ts` and `src/firebase.ts` may import from `firebase/firestore` or `firebase/auth`.

---

## 1. Summary

| Category | Before | After |
|---|---|---|
| Files with direct `firebase/firestore` imports | 5 | 2 (✅ db.ts + firebase.ts only) |
| Files with direct `firebase/auth` imports | 3 | 2 (✅ db.ts + firebase.ts only) |
| Realtime `subscribeX` functions in db.ts | 0 | 8 (✅ added) |
| Auth abstraction functions in db.ts | 0 | 5 (✅ added) |
| `seedDefaultData` in db.ts | 0 | 1 (✅ added) |
| Integration test files | 0 | 3 (✅ added) |
| Supabase installer support | partial | ✅ full |

---

## 2. Files Modified

### `src/db.ts` — Extended (driver layer, the ONLY authorised Firebase importer)

**Additions:**
- Added `onSnapshot` to the `firebase/firestore` import block.
- Added `firebase/auth` import block: `signInWithEmailAndPassword`, `createUserWithEmailAndPassword`, `signOut as _fbSignOut`, `updatePassword`, `onAuthStateChanged`, `User`.
- Added `auth as _firebaseAuth` to the `./firebase` import.

**New exports:**
- `subscribeProducts(callback)` — realtime collection listener (Firebase onSnapshot / Supabase postgres_changes)
- `subscribeOrders(callback)` — realtime collection listener; orders sorted newest-first
- `subscribeReviews(callback)` — realtime collection listener
- `subscribeCategories(callback)` — realtime collection listener
- `subscribeCoupons(callback)` — realtime collection listener
- `subscribeNewsletterSubscribers(callback)` — realtime collection listener
- `subscribeSiteSettings(callback)` — realtime document listener for `settings/siteSettings`
- `subscribeSettingsDoc(key, callback)` — realtime document listener for any `settings/{key}`
- `seedDefaultData(opts)` — engine-agnostic batch seed (Firebase: writeBatch; Supabase/local: dbService methods)
- `signInAdmin(email, password)` — delegates to `signInWithEmailAndPassword`
- `createAdminAccount(email, password)` — delegates to `createUserWithEmailAndPassword`
- `signOutAdmin()` — delegates to Firebase `signOut`
- `updateAdminPassword(newPassword)` — delegates to `updatePassword`
- `onAuthStateChange(callback)` — delegates to `onAuthStateChanged`

All subscribe functions return a `() => void` unsubscribe function. In local mode (no cloud backend), they return a no-op.

---

### `src/firebaseService.ts` — Refactored

**Removed:** `import { doc, onSnapshot } from 'firebase/firestore'`

**Changed:** `getLiveSettings()` — was using direct `onSnapshot`; now delegates to `subscribeSiteSettings()` from `db.ts`. Behaviour is identical: fires immediately with current data, then on every change.

`updateSettings()` and `fileToDataUrl()` already used `dbService` and `fileToBase64` — no logic change needed.

---

### `src/firestore-service.ts` — Refactored

**Removed:** All direct `firebase/firestore` imports:
```
doc, collection, setDoc, deleteDoc, getDocs, onSnapshot, Unsubscribe, getDoc, writeBatch, query, where
```

**Changed:** Every function now delegates to `dbService` or the new `subscribe*` functions from `db.ts`:

| Old (direct Firebase) | New (via db.ts) |
|---|---|
| `setDoc(doc(db, 'coupons', id), data)` | `dbService.saveCoupon(data)` |
| `deleteDoc(doc(db, 'coupons', id))` | `dbService.deleteCoupon(id)` |
| `getDocs(collection(db, 'coupons'))` | `dbService.getCoupons()` |
| `onSnapshot(collection(db, 'coupons'), cb)` | `subscribeCoupons(cb)` |
| `setDoc(doc(db, 'categories', id), data)` | `dbService.saveCategory(data)` |
| `deleteDoc(doc(db, 'categories', id))` | `dbService.deleteCategory(id)` |
| `getDocs(collection(db, 'categories'))` | `dbService.getCategories()` |
| `onSnapshot(collection(db, 'categories'), cb)` | `subscribeCategories(cb)` |
| `getDoc(doc(db, 'settings', 'store_config'))` | `dbService.getSiteSettings()` |
| `setDoc(docRef, merged, { merge: true })` | `dbService.saveSiteSettings(merged)` |
| `onSnapshot(docRef, cb)` | `subscribeSiteSettings(cb)` |
| `query(coll, where('code', '==', code))` | `dbService.getCoupons()` then `.find()` |

Public API is preserved — all exported function signatures unchanged.

---

### `src/context/AppContext.tsx` — Refactored

**Removed imports:**
- `import { collection, writeBatch, doc, setDoc } from 'firebase/firestore'`
- `import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut as fbSignOut, updatePassword, onAuthStateChanged } from 'firebase/auth'`
- `getDb` from `../firebase` (no longer needed since `seedDefaultData` handles batch writes)

**Added imports from `../db`:**
- `subscribeProducts, subscribeOrders, subscribeReviews, subscribeCategories, subscribeCoupons, subscribeNewsletterSubscribers, subscribeSiteSettings, subscribeSettingsDoc, seedDefaultData, signInAdmin, createAdminAccount, signOutAdmin, updateAdminPassword, onAuthStateChange`

**Changed listener functions** (now synchronous, delegate to db.ts):

| Old function | Change |
|---|---|
| `_attachFirebaseSettingsListener()` | Uses `subscribeSiteSettings(cb)` |
| `_attachFirebaseCatalogListeners()` | Uses `subscribeProducts(cb)` + `subscribeCategories(cb)` |
| `_attachFirebaseSettingsDocListeners()` | Uses `subscribeSettingsDoc(key, cb)` for each key |
| `_attachFirebaseAuthRestrictedListeners()` | Uses `subscribeNewsletterSubscribers(cb)` |
| `_attachOrdersListener()` | Uses `subscribeOrders(cb)` |
| Inline coupons/reviews in `_mountListenersForEngine` | Uses `subscribeCoupons(cb)` + `subscribeReviews(cb)` |

**Changed auth calls in `setAdminLoggedIn()`:**

| Old | New |
|---|---|
| `onAuthStateChanged(auth, cb)` | `onAuthStateChange(cb)` |
| `signInWithEmailAndPassword(auth, email, pw)` | `signInAdmin(email, pw)` |
| `createUserWithEmailAndPassword(auth, email, pw)` | `createAdminAccount(email, pw)` |
| `updatePassword(cred.user, pw)` | `updateAdminPassword(pw)` |
| `fbSignOut(auth)` | `signOutAdmin()` |

**Changed auto-seed block in `switchDatabaseEngine()`:**
```typescript
// Before: direct writeBatch + doc + batch.set + batch.commit
// After:
await seedDefaultData({ products: DEFAULT_PRODUCTS, categories: DEFAULT_CATEGORIES,
                        coupons: DEFAULT_COUPONS, reviews: DEFAULT_REVIEWS });
```

---

### `src/components/InstallWizard.tsx` — Refactored

**Removed imports:**
- `import { doc, setDoc, writeBatch } from 'firebase/firestore'`
- `import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'`

**Added imports from `../db`:**
- `seedDefaultData, signInAdmin, createAdminAccount, dbService`

**Changed sub-steps 3–7:**

| Sub-step | Old (direct Firebase) | New (via db.ts) |
|---|---|---|
| 3 Auth | `createUserWithEmailAndPassword(auth!, email, pw)` | `createAdminAccount(email, pw)` |
| 3 Auth sign-in fallback | `signInWithEmailAndPassword(auth!, email, pw)` | `signInAdmin(email, pw)` |
| 4 Seed data | `writeBatch(db)` + `.set()` × N + `.commit()` | `seedDefaultData({ products, categories, coupons, reviews })` |
| 5 Admin account | `setDoc(doc(db, 'settings', 'adminSettings'), data)` | `dbService.saveAdminSettings(data)` |
| 6 Store settings | `writeBatch(db)` + `.set()` × 4 + `.commit()` | `seedDefaultData({ siteSettings, paymentSettings, smtpSettings, supportSettings })` |
| 7 Finalise | `setDoc(doc(db, 'settings', 'install_status'), data)` | `seedDefaultData({ installStatus: data })` |

---

### `src/components/AdminPanel.tsx` — Refactored

**Removed imports:**
- `saveCoupon as firestoreSaveCoupon` and `deleteCoupon as firestoreDeleteCoupon` from `../firestore-service`

**Added imports:**
- `dbService` from `../db`

**Changed coupon operations:**

| Old | New |
|---|---|
| `await firestoreSaveCoupon(coup)` (Firebase-only) | `await dbService.saveCoupon(coup)` (engine-agnostic) |
| `await firestoreDeleteCoupon(c.id)` (Firebase-only) | `await dbService.deleteCoupon(c.id)` (engine-agnostic) |

---

## 3. Files Unchanged

- `src/firebase.ts` — Boot shim; intentionally imports from `firebase/auth` and `firebase/firestore`. No changes needed.
- `src/supabase.ts` — Supabase client setup. No changes needed.
- `src/types.ts` — Pure types. No changes needed.
- `src/installStatus.ts` — No Firebase imports. No changes needed.
- All payment gateway files (`lib/payments/`) — No Firebase imports. No changes needed.
- All other component files — No direct Firebase imports.

---

## 4. Integration Tests Added

| File | Engine | Coverage |
|---|---|---|
| `src/tests/db-integration.test.ts` | Local (mock) | All subscribe* exports, auth abstractions, seedDefaultData, dbService method presence, engine detection |
| `src/tests/firebase-integration.test.ts` | Firebase (mock) | onSnapshot called per subscribe*, writeBatch used in seedDefaultData, auth functions delegate correctly, file-level SDK import audit |
| `src/tests/supabase-integration.test.ts` | Supabase (mock) | Supabase realtime channel created per subscribe*, seedDefaultData uses dbService, CRUD smoke tests |

To run all tests:
```bash
npx vitest run src/tests/
```

---

## 5. Architecture Invariant (Post-Refactor)

```
firebase/firestore  ──► src/firebase.ts  (boot shim — no logic)
firebase/auth       ──► src/firebase.ts  (boot shim — no logic)
                         │
                         ▼
firebase/firestore  ──► src/db.ts  (SOLE driver layer — all direct SDK calls here)
firebase/auth       ──► src/db.ts  (SOLE driver layer — all auth calls here)
                         │
                  ┌──────┴──────────────────────┐
                  ▼                             ▼
           src/firebaseService.ts        src/firestore-service.ts
           src/context/AppContext.tsx    src/components/InstallWizard.tsx
           src/components/AdminPanel.tsx (and all other files)
```

No file other than `src/db.ts` and `src/firebase.ts` may import from `firebase/*` SDK packages.

---

## 6. Verification Commands

```bash
# Confirm no direct Firebase SDK imports outside allowed files:
grep -rn "from 'firebase/firestore'" src/ | grep -v "src/db.ts\|src/firebase.ts"
grep -rn "from 'firebase/auth'"      src/ | grep -v "src/db.ts\|src/firebase.ts"

# Expected output: empty (exit 1 from grep = no matches = PASS)
```
