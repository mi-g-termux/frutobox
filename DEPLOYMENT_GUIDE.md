# Fruitopia — Deployment & Security Guide

## Local Development
Works out of the box. The Install Wizard writes credentials to
`firebase-config.json` or `src/firebase-applet-config.json` on disk.
The `.env` file is optional — leave it empty and the wizard handles everything.

---

## Deploying to Vercel / Netlify / Render

These platforms have **read-only filesystems** — the app cannot write
`firebase-config.json` to disk at runtime. Instead, you must provide
credentials as **environment variables** before the build.

### Step-by-step

1. Run the Install Wizard locally first to get your Firebase config values.
2. In your hosting platform's dashboard, add these environment variables:

   ```
   VITE_FIREBASE_API_KEY=AIza...
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
   VITE_FIREBASE_APP_ID=1:123456789:web:abc123
   VITE_FIREBASE_DATABASE_ID=(default)
   VITE_APP_URL=https://yourdomain.com
   ```
   
   For **Supabase** also add:
   ```
   VITE_SUPABASE_URL=https://xyz.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

3. Trigger a redeploy. The Install Wizard will not appear again.

### Platform-specific notes

| Platform | Where to add env vars |
|---|---|
| **Vercel** | Project → Settings → Environment Variables → Production + Preview |
| **Netlify** | Site → Site Settings → Environment Variables |
| **Render** | Service → Environment → Add env var |
| **cPanel** | Use the `.env` file on disk — the wizard can write it via SSH/FTP |

---

## Security: What goes in `.env` vs what is safe

| Variable | Safe to expose? | Why |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | ✅ Yes | Firebase Web API keys are public by design. Restrict usage via Firebase Console → API restrictions. |
| `VITE_SUPABASE_ANON_KEY` | ✅ Yes | Anon/publishable key is public. Row-level security in Supabase controls access. |
| Firebase **Service Account** JSON | ❌ Never | Admin SDK secret — never put in VITE_ vars or client code |
| Supabase **service_role** key | ❌ Never | Bypasses all RLS — server-only |
| Payment gateway **secret keys** | ❌ Never | Keep only in server-side API routes (`/api/*`) |

> **Rule:** Anything in a `VITE_` variable is bundled into the client JS and
> visible to anyone who opens DevTools. Only put public/publishable keys there.
> All secrets (bKash app secret, Razorpay secret, SMTP password, etc.) must
> stay in server-side environment variables and only be used inside `/api/*` routes.

---

## Tax Configuration

Tax is now on the **Delivery** tab in the admin panel (not Payment Credentials).

- Enter as a decimal: `0.09` = 9%, `0.05` = 5%, `0` = **no tax**
- Setting to `0` completely removes tax from all orders
- The storefront respects this immediately after saving

---

## Currency Conversion for International Customers

When your store currency is **USD** but a customer pays via **bKash / Nagad /
SSLCommerz / Razorpay / Paytm / UPI / JazzCash / Easypaisa / PayFast**, the
checkout automatically:

1. Fetches the live exchange rate (cached 10 minutes)
2. Shows the converted amount below the Grand Total
3. Passes the converted amount to the payment gateway

This means a product priced at **$4.00 USD** will show as **≈ ৳440 BDT**
(at ~110 BDT/USD) when the customer selects bKash — they pay the correct
local amount, not $4 treated as ৳4.

International gateways (Stripe, PayPal) handle conversion server-side and
are unaffected.

---

## Payment Button Logos

- Logos now display **without the payment method name** shown underneath
- The name only appears for icon-only methods (Bank Transfer, Manual Card Ref)
  or if you have set a custom display name in the admin panel
- If a logo fails to load, the name appears as a fallback automatically
