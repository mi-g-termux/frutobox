# Fruitopia — Bugfix bundle

All fixes are wired through the existing `getActiveEngine()` / `dbService`
abstraction in `src/db.ts`, so they work on **both Firebase and Supabase** —
whichever backend was selected during the install wizard.

## 1. Phone number now syncs to the user's account at checkout
- `src/context/AppContext.tsx` → `ensureUserAfterCheckout`
- New guest checkouts: the phone the customer typed is saved on the
  auto-created profile (and shown in the "My Account" modal).
- Existing accounts that previously had no phone are also back-filled on the
  next checkout — no manual re-entry needed.
- `phoneKey` is intentionally left blank so the phone is **not** turned into a
  unique login index — the real owner of that number can still sign up later.

## 2. Admin → Add Product: Single vs Variant toggle
- `src/components/AdminPanel.tsx`
- New "Product Type" segmented control at the top of the product form.
- `Single Product` → price + sale price + stock visible; variant editor
  hidden; any stored variant rows are wiped on save.
- `Variant Product` → the single price/stock fields disappear; each variant
  (e.g. `250 ml`, `500 ml`, `Size: L`) carries its own price and stock.
- Headline `product.price` / `product.stock` are derived automatically from
  variants (min price, total stock) so the product card still shows useful
  numbers.
- Backward compatible: legacy products without `productMode` are inferred
  from whether they actually have variant rows in the database.

## 3. Partial COD wired to delivery areas
- `src/types.ts` — `DeliveryZone.partialCodAmount?: number`
- `src/components/AdminPanel.tsx` — when the per-zone toggle is enabled,
  admin can now type a custom **Advance amount** (leave blank to default to
  the zone's delivery fee).
- `src/components/CartModal.tsx` — the COD prepayment flow uses
  `matchedZone.partialCodAmount` (clamped to grand total) instead of the
  hardcoded delivery fee, so each zone can demand its own advance.
- Order record persists `paidAmount` + `outstandingAmount` exactly as
  before; admin/invoice/email all read from those.

## 4. Invoice PDF now shows variant details
- `src/lib/invoicePdf.ts` — each line item gets an italic sub-line such as
  `Size: 500 ml` or `Color: Black / Size: XL`.
- `src/components/CartModal.tsx` — the cart-to-order mapping now propagates
  both `variantLabel` and the raw `selectedVariants` map into every
  `OrderItem`, so the PDF, the order detail screens, and the confirmation
  email all read the same source of truth.
- Older orders saved before the upgrade still render correctly (the variant
  line just won't appear, since none was captured at the time).

## 5. Order-confirmation email for Partial COD
- `src/context/AppContext.tsx` → `placeOrder` already sends the
  confirmation email for **every** payment method (including partial COD).
- The template now includes:
  - a per-line variant label (matches the invoice PDF)
  - an amber "Partial COD" block showing **Paid online (advance)** and
    **Due on delivery** whenever `paidAmount > 0` and `outstandingAmount > 0`
- Admin notification email is also unchanged in delivery — the same
  pipeline fires for partial COD orders.

## 6. SMTP settings persist across devices
- Root cause: `AdminPanel.tsx` was seeding its local input state from
  `smtpSettings` **once** at mount. On a new device the real-time
  Firestore/Supabase listener fires *after* mount, but the inputs never
  re-hydrated — so the form looked empty and re-saving wiped the backend
  record.
- Fix: an explicit `useEffect([smtpSettings])` re-syncs every SMTP input
  (host, port, email, password, fromName, OTP config, all email templates)
  whenever the backend pushes an update.
- The underlying storage (`dbService.saveSMTPSettings` →
  Firestore `settings/smtpSettings` doc or Supabase `app_settings` row) was
  already correct, so no schema migration is needed.

## Manual smoke-test checklist

1. Guest checkout with a new email → open the user dropdown / Account modal
   → phone is pre-filled.
2. Admin → Add Product → toggle `Single Product`: variant editor is hidden.
   Toggle `Variant Product`: single price/stock fields are hidden.
3. Admin → Delivery → enable Partial COD on Zone A only and set advance to
   200 → place a Zone-A COD order: gateway charges 200 upfront. Zone B
   stays full-COD.
4. Open the generated invoice PDF for a variant order → each line shows the
   variant under the product name.
5. Place a Partial COD order → confirmation email arrives showing the
   advance + remaining split.
6. Save SMTP → log out → log in on another browser/device → SMTP form is
   still populated; a test email sends successfully.

## Files changed

- `src/types.ts`
- `src/lib/invoicePdf.ts`
- `src/components/CartModal.tsx`
- `src/components/AdminPanel.tsx`
- `src/context/AppContext.tsx`

No new npm dependencies, no schema migrations.
