# Fruitopia — Complete Setup & Deployment Guide

> A full-featured fruit e-commerce store built with React + Vite + TypeScript + Express.  
> Supports **Firebase** and **Supabase** as interchangeable backends, with 16 payment gateways, SMTP email, SMS, and a built-in admin panel.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Local Development](#3-local-development)
4. [Backend Setup — Firebase](#4-backend-setup--firebase)
5. [Backend Setup — Supabase](#5-backend-setup--supabase)
6. [Environment Variables Reference](#6-environment-variables-reference)
7. [Payment Gateways](#7-payment-gateways)
8. [Email (SMTP)](#8-email-smtp)
9. [SMS Notifications](#9-sms-notifications)
10. [Deploy to Vercel](#10-deploy-to-vercel)
11. [Deploy to Render](#11-deploy-to-render)
12. [Deploy to cPanel](#12-deploy-to-cpanel)
13. [Deploy to VPS (Ubuntu)](#13-deploy-to-vps-ubuntu)
14. [Switching Backends After Deploy](#14-switching-backends-after-deploy)
15. [Admin Panel Guide](#15-admin-panel-guide)
16. [Firestore Security Rules](#16-firestore-security-rules)
17. [Supabase RLS Policies](#17-supabase-rls-policies)
18. [Troubleshooting](#18-troubleshooting)

---

## 1. Project Overview

Fruitopia is a production-ready storefront. Out of the box it includes:

| Feature | Details |
|---|---|
| Product catalog | Categories, variants, stock, images |
| Cart & Checkout | Full cart modal with address & payment |
| 16 Payment methods | COD, bKash, Nagad, Rocket, Bank, Stripe, PayPal, SSLCommerz, Razorpay, Paytm, UPI, JazzCash, Easypaisa, PayFast, bKash Auto, Nagad Auto |
| Order management | Orders list, status tracking, invoices |
| Admin panel | Products, orders, payments, SMTP, SMS, branding, security |
| Install wizard | Browser-based guided setup — no CLI needed |
| Dual backend | Switch between Firebase and Supabase at any time |
| Live chat | Optional Tawk.to integration |
| Email | SMTP order confirmations |
| SMS | Twilio or custom gateway |

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 5, TypeScript, Tailwind CSS v4 |
| Backend | Express (Node.js), TypeScript |
| Databases | Firebase Firestore **or** Supabase (PostgreSQL) |
| Auth | Firebase Auth **or** Supabase Auth |
| Storage | Firebase Storage **or** Supabase Storage |
| Build | Vite (client), esbuild (server) |
| Process manager (VPS) | PM2 |

---

## 3. Local Development

### Prerequisites

- Node.js 18+ (LTS recommended)
- npm or pnpm

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Copy env template
cp .env.example .env

# 3. Start dev server (Vite frontend + Express backend on one port)
npm run dev
```

The app runs at **http://localhost:5173** by default.  
On first visit you will see the **Install Wizard** — follow the steps to connect Firebase or Supabase.

### Available Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start local dev server |
| `npm run build` | Production build (auto-detects platform) |
| `npm run build:render` | Build for Render |
| `npm run build:vercel` | Build for Vercel |
| `npm run build:cpanel` | Build for cPanel (local build, then upload) |
| `npm run build:vps` | Build for VPS |
| `npm start` | Start production server (after build) |

---

## 4. Backend Setup — Firebase

### Step 1 — Create a Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → give it a name → continue
3. Disable Google Analytics if not needed → **Create project**

### Step 2 — Enable Services

| Service | How to enable |
|---|---|
| **Firestore** | Build → Firestore Database → Create database → Start in **test mode** |
| **Auth** | Build → Authentication → Get started → Enable **Email/Password** |
| **Storage** | Build → Storage → Get started → Start in **test mode** |

### Step 3 — Get Your Credentials

1. Project Settings ⚙️ (gear icon top left)
2. Scroll to **Your apps** → click your web app (or click **Add app** → Web)
3. Copy the `firebaseConfig` object — you need all 6 values:

```
apiKey
authDomain
projectId
storageBucket          ← required (do NOT leave blank)
messagingSenderId      ← required (do NOT leave blank)
appId
```

### Step 4 — Run the Install Wizard

Visit your site URL → the wizard launches automatically.  
Choose **Firebase** → paste your credentials → follow all 8 steps.

After the wizard completes, it shows a panel with the env vars to add to your hosting platform (see [Section 10–13](#10-deploy-to-vercel)).

### Step 5 — Deploy Firestore Security Rules

In the Firebase Console → **Firestore** → **Rules** tab, paste:

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /settings/{doc} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /products/{doc} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /categories/{doc} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /orders/{doc} {
      allow read, write: if request.auth != null;
    }
    match /admins/{doc} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Click **Publish**.

---

## 5. Backend Setup — Supabase

### Step 1 — Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Choose your organisation → set a project name and database password
3. Select the region closest to your users → **Create new project**
4. Wait ~2 minutes for provisioning

### Step 2 — Get Your Credentials

Project Settings → **API**:

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | **Project URL** (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | **anon / public** key under Project API keys |

### Step 3 — Run the Install Wizard

Visit your site URL → the wizard launches automatically.  
Choose **Supabase** → paste Project URL + Anon Key → follow all 7 steps.

The wizard will:
- Create the required tables (`settings`, `products`, `categories`, `orders`, `admins`)
- Seed sample products and categories
- Create your admin account
- Show you the env vars to add to your hosting platform

### Step 4 — Apply RLS Policies

See [Section 17 — Supabase RLS Policies](#17-supabase-rls-policies).

---

## 6. Environment Variables Reference

Create a `.env` file at the project root (copy from `.env.example`).

### Firebase Variables

```env
VITE_FIREBASE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abcdef123456
VITE_FIREBASE_DATABASE_ID=(default)
```

### Supabase Variables

```env
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI...
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI...
```

> **Note:** Both `SUPABASE_*` (server-side) and `VITE_SUPABASE_*` (client-side) are needed so both the Express server and the Vite frontend can connect.

### App Variables

```env
NODE_ENV=production
PORT=3005
SESSION_SECRET=change-this-to-a-random-64-char-string
```

### Email (SMTP)

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your@gmail.com
```

### SMS (Twilio)

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+1234567890
```

### Payment Gateways

```env
# Stripe
STRIPE_SECRET_KEY=sk_live_XXXXXXXX
STRIPE_PUBLISHABLE_KEY=pk_live_XXXXXXXX
STRIPE_WEBHOOK_SECRET=whsec_XXXXXXXX

# PayPal
PAYPAL_CLIENT_ID=XXXXXXXX
PAYPAL_CLIENT_SECRET=XXXXXXXX
PAYPAL_MODE=live

# Razorpay
RAZORPAY_KEY_ID=rzp_live_XXXXXXXX
RAZORPAY_KEY_SECRET=XXXXXXXX

# SSLCommerz
SSLCOMMERZ_STORE_ID=your_store_id
SSLCOMMERZ_STORE_PASS=your_store_pass
SSLCOMMERZ_LIVE=true

# bKash (Automated)
BKASH_APP_KEY=XXXXXXXX
BKASH_APP_SECRET=XXXXXXXX
BKASH_USERNAME=XXXXXXXX
BKASH_PASSWORD=XXXXXXXX
BKASH_BASE_URL=https://tokenized.pay.bka.sh/v1.2.0-beta

# Nagad (Automated)
NAGAD_MERCHANT_ID=XXXXXXXX
NAGAD_MERCHANT_PRIVATE_KEY=XXXXXXXX
NAGAD_MERCHANT_PUBLIC_KEY=XXXXXXXX
NAGAD_BASE_URL=https://api.mynagad.com

# JazzCash
JAZZCASH_MERCHANT_ID=XXXXXXXX
JAZZCASH_PASSWORD=XXXXXXXX
JAZZCASH_INTEGRITY_SALT=XXXXXXXX

# Easypaisa
EASYPAISA_STORE_ID=XXXXXXXX
EASYPAISA_HASH_KEY=XXXXXXXX

# PayFast
PAYFAST_MERCHANT_ID=XXXXXXXX
PAYFAST_MERCHANT_KEY=XXXXXXXX
PAYFAST_PASSPHRASE=XXXXXXXX

# Paytm
PAYTM_MID=XXXXXXXX
PAYTM_MERCHANT_KEY=XXXXXXXX
```

---

## 7. Payment Gateways

Fruitopia supports 16 payment methods configurable from the Admin Panel → **Payments** section.

| Method | Type | Countries |
|---|---|---|
| **COD** | Manual | Everywhere |
| **Bank Transfer** | Manual | Everywhere |
| **bKash (Manual)** | Manual QR/Number | Bangladesh |
| **Nagad (Manual)** | Manual QR/Number | Bangladesh |
| **Rocket** | Manual QR/Number | Bangladesh |
| **bKash (Auto)** | Automated API | Bangladesh |
| **Nagad (Auto)** | Automated API | Bangladesh |
| **Stripe** | Card payments | Global |
| **PayPal** | PayPal wallet | Global |
| **SSLCommerz** | Card/MFS gateway | Bangladesh |
| **Razorpay** | Card/UPI/wallet | India |
| **Paytm** | Paytm wallet | India |
| **UPI / QR** | Manual UPI | India |
| **JazzCash** | Mobile wallet | Pakistan |
| **Easypaisa** | Mobile wallet | Pakistan |
| **PayFast** | Card/EFT | South Africa |

### Enabling a Gateway

1. Admin Panel → **Payments**
2. Toggle the gateway **on**
3. Enter API keys / account numbers
4. Optionally upload a custom logo image (otherwise the built-in transparent logo is used)
5. Click **Save Payments Configuration**

### Manual Gateways (bKash, Nagad, Rocket, Bank, UPI)

For manual methods, enter your account number / QR image URL. Customers select the method, send money, and submit an order — you confirm manually.

---

## 8. Email (SMTP)

Admin Panel → **Email Settings**

| Field | Example |
|---|---|
| SMTP Host | `smtp.gmail.com` |
| SMTP Port | `587` (TLS) or `465` (SSL) |
| Username | `you@gmail.com` |
| Password | Gmail App Password (not your account password) |
| From address | `orders@yourstore.com` |

**Gmail App Password:**  
Google Account → Security → 2-Step Verification → App passwords → Generate.

Fruitopia sends emails for:
- New order confirmation (to customer)
- New order alert (to admin)
- Order status update

---

## 9. SMS Notifications

Admin Panel → **Notifications → SMS**

Powered by **Twilio**. Enter:
- Account SID
- Auth Token  
- From phone number (Twilio number)

SMS is sent when:
- A new order is placed (to admin number)
- Order status changes to Shipped or Delivered (to customer)

---

## 10. Deploy to Vercel

**Best for:** Fast, free, zero-config deployments.

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/fruitopia.git
git push -u origin main
```

### Step 2 — Import to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New → Project**
2. Import your GitHub repo
3. Framework preset: **Vite**
4. Build command: `npm run build:vercel`
5. Output directory: `dist`

### Step 3 — Add Environment Variables

In Vercel → Project → **Settings → Environment Variables**, add all variables from [Section 6](#6-environment-variables-reference) that apply to your chosen backend.

**Minimum required (Firebase):**
```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
SESSION_SECRET
```

**Minimum required (Supabase):**
```
SUPABASE_URL
SUPABASE_ANON_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SESSION_SECRET
```

### Step 4 — Deploy

Click **Deploy**. Vercel auto-deploys on every push to `main`.

### Verify

Visit your `.vercel.app` URL → you should see the store (or Install Wizard if credentials aren't set yet).

---

## 11. Deploy to Render

**Best for:** Full-stack Node.js apps, simple dashboard setup.

### Step 1 — Create a Web Service

1. [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Configure:

| Setting | Value |
|---|---|
| Environment | Node |
| Build command | `npm install && npm run build:render` |
| Start command | `npm start` |
| Auto-deploy | Yes |

### Step 2 — Add Environment Variables

Render Dashboard → Your Service → **Environment** tab.  
Add all variables from [Section 6](#6-environment-variables-reference).

> Set **Sync to Git = OFF** for every secret variable.

### Step 3 — Deploy

Click **Create Web Service** — Render builds and deploys (~3–5 min).

### Render-Specific Notes

- Render uses port `10000` by default — `PORT` is injected automatically.
- Free tier services sleep after 15 min of inactivity (first request is slow).
- Upgrade to a paid plan for always-on hosting.

---

## 12. Deploy to cPanel

**Best for:** Existing shared hosting with cPanel.

### Option A — Node.js App (if host supports it)

**Check:** cPanel → Software → Setup Node.js App.

1. Build locally:
   ```bash
   npm run build:cpanel
   ```

2. Upload via FTP (FileZilla / cPanel File Manager) to `public_html/fruitopia/`:
   ```
   public_html/
   └── fruitopia/
       ├── package.json
       ├── server.js          ← compiled server
       ├── .env               ← your env vars
       └── dist/
           ├── index.html
           └── assets/
   ```

3. cPanel → Setup Node.js App → Create application:
   - Application root: `public_html/fruitopia`
   - Application URL: your domain
   - Application startup file: `server.js`
   - Click **Create** → **Run NPM Install** → **Start**

### Option B — Static + PHP Proxy

If your host does not support Node.js, run the server on a VPS and serve only the `dist/` folder from cPanel. This is the most reliable cPanel approach.

---

## 13. Deploy to VPS (Ubuntu)

**Best for:** Full control, high traffic, custom domains with SSL.

### Step 1 — Initial Server Setup

```bash
ssh root@YOUR_SERVER_IP

# Update system
apt update && apt upgrade -y

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt install -y nodejs

# Install PM2
npm install -g pm2
pm2 startup

# Install Nginx
apt install -y nginx
systemctl enable nginx

# Install Certbot (SSL)
apt install -y certbot python3-certbot-nginx
```

### Step 2 — Clone & Configure

```bash
mkdir -p /var/www/fruitopia
cd /var/www/fruitopia
git clone https://github.com/YOUR_USERNAME/fruitopia.git .

# Create .env
cp .env.example .env
nano .env        # paste your env vars
```

### Step 3 — Build & Start

```bash
npm install
npm run build:vps
pm2 start dist-server/server.js --name fruitopia
pm2 save
```

### Step 4 — Nginx Config

```bash
nano /etc/nginx/sites-available/fruitopia
```

Paste:
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://localhost:3005;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/fruitopia /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### Step 5 — Enable SSL

```bash
certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Certbot auto-renews. Done!

### Useful PM2 Commands

```bash
pm2 logs fruitopia          # View live logs
pm2 restart fruitopia       # Restart after .env changes
pm2 stop fruitopia          # Stop the server
pm2 status                  # Check running processes
```

---

## 14. Switching Backends After Deploy

You can switch from Firebase → Supabase or vice versa at any time.

### How to Switch

1. Admin Panel → **Settings → Backend**
2. Click **Reconfigure / Switch Backend**
3. Read the warning carefully:
   - The browser clears the install lock and redirects you to the Install Wizard
   - **You must also delete the old backend's env vars from your hosting platform and redeploy** — otherwise the server still boots with the old backend

### Removing Old Env Vars

**Switching away from Firebase** — delete from your host:
```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_DATABASE_ID
```

**Switching away from Supabase** — delete from your host:
```
SUPABASE_URL
SUPABASE_ANON_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Redeploy (or `pm2 restart fruitopia` on VPS) after deleting the vars.

### Data Migration

Existing data in the old backend is **not deleted** — it stays there. If you want to move products/orders to the new backend, export from the old database and import manually.

---

## 15. Admin Panel Guide

Access the admin panel at `/admin` or via the lock icon in the navbar.

Default credentials (set during Install Wizard):
- Username: what you chose
- Password: what you chose

### Sections

| Section | What you can do |
|---|---|
| **Dashboard** | Sales stats, recent orders, quick links |
| **Products** | Add / edit / delete products, upload images, set stock |
| **Categories** | Manage product categories |
| **Orders** | View all orders, update status, print invoices |
| **Payments** | Enable/disable gateways, enter API keys, upload logos |
| **Branding** | Store name, logo, hero text, colours, footer |
| **Email** | Configure SMTP for order emails |
| **Notifications** | SMS via Twilio, push notification settings |
| **Support** | Tawk.to live chat widget ID |
| **Security** | Change admin username / password |
| **Backend** | View active backend, switch to other backend |

---

## 16. Firestore Security Rules

Apply in Firebase Console → Firestore → **Rules** tab.

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Public settings (storefront reads them)
    match /settings/{doc} {
      allow read: if true;
      allow write: if request.auth != null;
    }

    // Products — public read, admin write
    match /products/{doc} {
      allow read: if true;
      allow write: if request.auth != null;
    }

    // Categories — public read, admin write
    match /categories/{doc} {
      allow read: if true;
      allow write: if request.auth != null;
    }

    // Orders — authenticated users only
    match /orders/{doc} {
      allow read, write: if request.auth != null;
    }

    // Admins — authenticated users only
    match /admins/{doc} {
      allow read, write: if request.auth != null;
    }
  }
}
```

> After configuring rules in **test mode** during setup, paste the rules above and click **Publish** to lock down the database for production.

---

## 17. Supabase RLS Policies

The Install Wizard creates the tables. You need to enable Row Level Security policies in Supabase → **Authentication → Policies**.

Run this in Supabase → **SQL Editor**:

```sql
-- Settings: public read, authenticated write
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read settings"  ON settings FOR SELECT USING (true);
CREATE POLICY "Auth write settings"   ON settings FOR ALL USING (auth.role() = 'authenticated');

-- Products: public read, authenticated write
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read products"  ON products FOR SELECT USING (true);
CREATE POLICY "Auth write products"   ON products FOR ALL USING (auth.role() = 'authenticated');

-- Categories: public read, authenticated write
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read categories" ON categories FOR SELECT USING (true);
CREATE POLICY "Auth write categories"  ON categories FOR ALL USING (auth.role() = 'authenticated');

-- Orders: authenticated only
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth orders"  ON orders FOR ALL USING (auth.role() = 'authenticated');

-- Admins: authenticated only
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth admins"  ON admins FOR ALL USING (auth.role() = 'authenticated');
```

---

## 18. Troubleshooting

### Install Wizard keeps re-appearing

**Cause:** The server doesn't see valid backend credentials in its env vars.  
**Fix:** Set the Firebase or Supabase env vars on your hosting platform and redeploy. The server reads credentials from env at boot — LocalStorage alone is not enough after a server restart.

---

### "Firebase not initialized" / blank store

**Checklist:**
1. All 6 `VITE_FIREBASE_*` vars are set (including `storageBucket` and `messagingSenderId`)
2. Variable names are EXACT — they are case-sensitive
3. App was redeployed after adding the vars
4. Firebase project still exists and is not deleted
5. Firestore is enabled (not just the project)

---

### Supabase connection fails

**Checklist:**
1. `SUPABASE_URL` starts with `https://` and ends with `.supabase.co`
2. `SUPABASE_ANON_KEY` is the **anon/public** key (not the service role key)
3. Both `SUPABASE_*` and `VITE_SUPABASE_*` vars are set
4. Tables were created (run the Install Wizard or SQL manually)
5. RLS policies allow reads ([Section 17](#17-supabase-rls-policies))

---

### Payment gateway not working

1. Double-check API keys in Admin Panel → Payments (no extra spaces)
2. Make sure you are using **live** keys, not test keys, for production
3. For Stripe: ensure the webhook secret matches your Stripe dashboard
4. For bKash Auto / Nagad Auto: the merchant must be approved by the gateway

---

### Emails not sending

1. Admin Panel → Email → click **Send Test Email**
2. Check spam folder
3. For Gmail: use an **App Password** (not your account password), and ensure 2FA is on
4. For other SMTP: verify host, port, and that TLS/STARTTLS is enabled

---

### App crashes on VPS after restart

```bash
pm2 logs fruitopia --lines 50
```

Common causes:
- `.env` file missing or has wrong values → check and `pm2 restart fruitopia`
- Port already in use → `lsof -i :3005` and kill the process
- Node.js version mismatch → ensure Node 18+

---

### Slow cold starts on Render (free tier)

Free tier services sleep after 15 minutes idle. The first request after sleep takes 10–30 seconds.  
**Fix:** Upgrade to a paid Render plan or use Render's "always on" option.

---

## Platform Comparison

| Platform | Cost | Difficulty | Best For |
|---|---|---|---|
| **Vercel** | Free – $20/mo | ⭐ Very easy | Fastest setup, great DX |
| **Render** | $7 – $25/mo | ⭐⭐ Easy | Full-stack Node, simple dashboard |
| **cPanel** | $3 – $15/mo | ⭐⭐⭐ Medium | Reuse existing hosting |
| **VPS** | $6 – $20/mo | ⭐⭐⭐⭐ Hard | Full control, high traffic |

---

*Fruitopia — built for speed, scale, and simplicity.*  
*Last updated: June 2026*
