/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ─────────────────────────────────────────────────────────────────────────────
//  POLYMORPHIC DATABASE ENGINE TYPES
//  These types power the Dual-Backend Architecture (Local Mock / Firebase /
//  Supabase) and are consumed by db.ts, supabase.ts, AppContext.tsx, and
//  AdminPanel.tsx.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The three database engine modes supported by Fruitopia.
 *  - 'local'    : In-memory store backed by localStorage (always available, zero config)
 *  - 'firebase' : Google Firebase Firestore real-time database
 *  - 'supabase' : Supabase PostgreSQL + Realtime subscriptions
 */
export type DatabaseEngine = 'local' | 'firebase' | 'supabase';

/**
 * Credential shape for Firebase configuration.
 * Stored at localStorage key: `fruitopia_dynamic_firebase`
 */
export interface FirebaseCredentials {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  databaseId?: string; // Firestore named DB (default: "(default)")
}

/**
 * Credential shape for Supabase configuration.
 * Stored at localStorage key: `fruitopia_supabase_config`
 */
export interface SupabaseCredentials {
  projectUrl: string; // https://your-project-ref.supabase.co
  anonKey: string;    // Supabase anon public key (safe to expose in browser)
}

/**
 * Union credential type for the engine switcher.
 * The `switchActiveDatabaseEngine` function accepts this union.
 */
export type EngineCredentials = FirebaseCredentials | SupabaseCredentials | null;

// ─────────────────────────────────────────────────────────────────────────────
//  EXISTING TYPES — UNCHANGED
// ─────────────────────────────────────────────────────────────────────────────

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  salePrice: number | null;
  stock: number;
  image: string;         // Legacy — still used as fallback cover image
  coverImage?: string;   // PRIMARY cover image shown on cards, cart, search (overrides image)
  category: string;
  /**
   * Product creation mode chosen by the admin:
   *  - 'single'  → fixed price / stock, no variant editor.
   *  - 'variant' → price + stock come from per-variant rows; single price/stock fields hidden.
   * Optional for backward compatibility; legacy products without this field are inferred from
   * whether any variant rows exist on load.
   */
  productMode?: 'single' | 'variant';
  ingredients?: string[];
  rating: number;
  reviewsCount: number;
  isFeatured: boolean;
  isActive: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 3: GALLERY + VARIANT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A gallery image belonging to a product.
 * These are shown ONLY on the Product Detail Page — never on cards/homepage.
 */
export interface ProductImage {
  id: string;
  productId: string;
  imageUrl: string;
  sortOrder: number;
}

/**
 * A named group of variant options for a product.
 * E.g. { groupName: "Size" } or { groupName: "Color" }
 */
export interface ProductVariantGroup {
  id: string;
  productId: string;
  groupName: string;   // e.g. "Size", "Color", "Storage"
}

/**
 * A single variant within a group (one specific option).
 * Carries its own price, stock, and optional image.
 */
export interface ProductVariant {
  id: string;
  productId: string;
  groupName: string;      // e.g. "Size"
  variantValue: string;   // e.g. "500ml", "Black", "XL"
  price: number;
  stock: number;
  imageUrl?: string;      // Optional variant-specific image (shown only on detail page)
}

export interface CartItem {
  id: string;
  product: Product;
  quantity: number;
  /** Selected variant combination for variant-aware products */
  selectedVariants?: Record<string, string>; // { "Size": "500ml", "Color": "Black" }
  /** Resolved price for the selected variant combo (overrides product.price) */
  variantPrice?: number;
}

export type OrderStatus =
  | 'Pending'
  | 'Processing'
  | 'Confirmed'
  | 'Shipped'
  | 'Delivered'
  | 'Cancelled'
  | 'Refunded';

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  /**
   * Optional human-readable variant label for this line item, e.g.
   *   "Size: 500ml" or "Color: Black / Size: XL"
   * Populated from CartItem.selectedVariants at checkout time so the invoice
   * PDF, the order detail screens, and the confirmation email all show which
   * variant was actually ordered.
   */
  variantLabel?: string;
  /** Original selected variant map preserved verbatim for analytics/reconciliation. */
  selectedVariants?: Record<string, string>;
}

export interface Order {
  id: string;
  orderNumber: string;
  /** Deterministic customer account id derived from email; keeps all orders under one account. */
  userId?: string;
  customerName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode?: string;
  deliveryNote?: string;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  couponApplied: string | null;
  discount: number;
  total: number;
  paymentMethod: string;
  paymentStatus: 'Pending' | 'Paid' | 'Failed' | 'Delivery Fee Paid';
  orderStatus: OrderStatus;
  createdAt: string;
  transactionId?: string;
  /** Amount already paid upfront (used for COD delivery fee prepayment orders) */
  paidAmount?: number;
  /** Amount remaining due on delivery (= total - paidAmount) */
  outstandingAmount?: number;
}

export interface Coupon {
  id: string;
  code: string;
  discountPercentage: number;
  expiryDate: string;
  usageLimit: number;
  usedCount: number;
  isActive?: boolean;
}

export interface NewsletterSubscriber {
  id: string;
  email: string;
  subscribedAt: string;
}

export interface Review {
  id: string;
  productId: string;
  reviewerName: string;
  customerName?: string;
  rating: number;
  comment: string;
  isApproved: boolean;
  createdAt: string;
}

export interface SiteSettings {
  storeName?: string;
  websiteName: string;
  siteTitle: string;
  logoUrl?: string;       // Primary: uploaded image (base64 or URL). Preferred over emoji.
  logoEmoji?: string;     // Legacy fallback only — no longer used as primary logo
  faviconUrl?: string;    // Browser tab favicon (ICO/PNG/SVG, recommended 32×32px)
  heroBadge: string;
  heroTitleLine1: string;
  heroTitleLine2: string;
  heroSubtitle: string;
  heroButtonText: string;
  heroTimeBadge: string;
  footerText: string;
  footerLinks: { label: string; url: string }[];
  contactPhone: string;
  contactEmail: string;
  contactAddress: string;
  socialFacebook?: string;
  socialInstagram?: string;
  socialTwitter?: string;
  promoBannerEnabled: boolean;
  promoBannerText: string;
  themePrimaryColor: string; // hex
  themeBgColor: string; // hex or tailwind class
  themeHeaderFont: string; // 'Space Grotesk' | 'Inter' | 'Playfair Display'
  trademarkText: string;
  newsletterSectionIcon?: string; // SVG string or URL; defaults to built-in envelope icon
  testimonialSectionIcon?: string; // SVG string or URL; defaults to built-in star icon
  // Newsletter Section Customization
  newsletterTitle?: string;
  newsletterSubtitle?: string;
  newsletterSubmitButtonText?: string;
  // Testimonial Section Customization
  testimonialTitle?: string;
  testimonialSubtitle?: string;
  testimonialDisplayCount?: number; // How many testimonials to show
  ingredientLabel?: string;
  currency?: string;        // ISO code e.g. USD, BDT, EUR, GBP, INR
  currencySymbol?: string;  // Display symbol e.g. $, ৳, €, £, ₹
  currencyPosition?: 'before' | 'after'; // symbol before or after amount
  orderTrackerEnabled?: boolean; // Admin toggle: show/hide Order Tracker page
  orderTrackerInNavbar?: boolean; // Admin toggle: show Tracker link in navbar
  /** @deprecated Maintenance mode has been removed. Fields kept for schema compatibility only. */
  maintenanceMode?: boolean;
  maintenanceTitle?: string;
  maintenanceMessage?: string;
}

export interface SMTPSettings {
  host: string;
  port: string | number;
  email: string;
  password?: string;
  fromName?: string;       // Sender display name, e.g. "My Store"
  isEnabled: boolean;
  // OTP / Password-reset configuration
  otpEnabled?: boolean;    // Whether OTP email reset is active (default true when SMTP enabled)
  otpExpiryMinutes?: number; // How long OTP is valid (default 10)
  otpSubject?: string;     // Custom email subject line
  otpTemplate?: string;    // Custom OTP email body template
  // ── Editable email templates ────────────────────────────────────────────
  orderConfirmationSubject?: string;   // Subject for order confirmation email to customer
  orderConfirmationTemplate?: string;  // HTML template for order confirmation ({{orderNumber}}, {{customerName}}, {{items}}, {{total}}, etc.)
  orderStatusSubject?: string;         // Subject for order status change email to customer
  orderStatusTemplate?: string;        // HTML template for order status change
  adminOrderNotificationSubject?: string; // Subject for new order notification to admin
  adminOrderNotificationTemplate?: string; // HTML template for new order admin notification
  welcomeSubject?: string;             // Subject for welcome/registration email
  welcomeTemplate?: string;            // HTML template for welcome email
}

export interface PaymentSettings {
  // Payment method display branding (name + logo image overrides)
  codDisplayName?: string;
  codLogoImageUrl?: string;
  bKashDisplayName?: string;
  bKashLogoImageUrl?: string;
  nagadDisplayName?: string;
  nagadLogoImageUrl?: string;
  rocketDisplayName?: string;
  rocketLogoImageUrl?: string;
  bankDisplayName?: string;
  bankLogoImageUrl?: string;
  creditManualDisplayName?: string;
  creditManualLogoImageUrl?: string;
  paypalDisplayName?: string;
  paypalLogoImageUrl?: string;
  stripeDisplayName?: string;
  stripeLogoImageUrl?: string;
  bKashAutoDisplayName?: string;
  bKashAutoLogoImageUrl?: string;
  nagadAutoDisplayName?: string;
  nagadAutoLogoImageUrl?: string;
  sslCommerzDisplayName?: string;
  sslCommerzLogoImageUrl?: string;
  razorpayDisplayName?: string;
  razorpayLogoImageUrl?: string;
  paytmDisplayName?: string;
  paytmLogoImageUrl?: string;
  upiDisplayName?: string;
  upiLogoImageUrl?: string;
  jazzCashDisplayName?: string;
  jazzCashLogoImageUrl?: string;
  easypaisaDisplayName?: string;
  easypaisaLogoImageUrl?: string;
  payFastDisplayName?: string;
  payFastLogoImageUrl?: string;

  codEnabled: boolean;
  bKashEnabled: boolean;
  bKashNo: string;
  bKashInstructions: string;
  bKashLogoEmoji: string;
  bKashQrCodeUrl?: string;
  nagadEnabled: boolean;
  nagadNo: string;
  nagadInstructions: string;
  nagadLogoEmoji: string;
  nagadQrCodeUrl?: string;
  rocketEnabled: boolean;
  rocketNo: string;
  rocketInstructions: string;
  rocketLogoEmoji: string;
  rocketQrCodeUrl?: string;
  bankEnabled: boolean;
  bankNo: string;
  bankInstructions: string;
  bankLogoEmoji: string;
  bankQrCodeUrl?: string;
  bankName: string;
  bankHolder: string;
  creditManualEnabled: boolean;
  creditManualNo: string;
  creditManualInstructions: string;
  creditManualLogoEmoji: string;
  creditManualQrCodeUrl?: string;
  paypalEnabled?: boolean;
  paypalClientId?: string;
  paypalClientSecret?: string;
  paypalSandboxMode?: boolean;
  bKashAutoEnabled?: boolean;
  bKashAppKey?: string;
  bKashAppSecret?: string;
  bKashUsername?: string;
  bKashPassword?: string;
  bKashSandboxMode?: boolean;
  nagadAutoEnabled?: boolean;
  nagadMerchantId?: string;
  nagadMerchantPrivateKey?: string;
  nagadPublicKey?: string;
  nagadSandboxMode?: boolean;
  stripeEnabled: boolean;
  stripePublicKey: string;
  stripeSecretKey: string;
  stripeSandboxMode: boolean;
  sslCommerzEnabled: boolean;
  sslCommerzStoreId: string;
  sslCommerzStorePassword: string;
  sslCommerzSandboxMode: boolean;
  razorpayEnabled: boolean;
  razorpayKeyId: string;
  razorpayKeySecret: string;
  razorpaySandboxMode: boolean;
  // ── Paytm (India) ─────────────────────────────────────────────
  paytmEnabled?: boolean;
  paytmMerchantId?: string;
  paytmMerchantKey?: string;
  paytmSandboxMode?: boolean;
  // ── UPI manual (India — VPA + QR) ─────────────────────────────
  upiManualEnabled?: boolean;
  upiId?: string;             // VPA, e.g. merchant@oksbi
  upiPayeeName?: string;
  upiQrCodeUrl?: string;
  upiInstructions?: string;
  // ── JazzCash (Pakistan) ───────────────────────────────────────
  jazzCashEnabled?: boolean;
  jazzCashMerchantId?: string;
  jazzCashPassword?: string;
  jazzCashIntegritySalt?: string;
  jazzCashSandboxMode?: boolean;
  // ── Easypaisa (Pakistan) ──────────────────────────────────────
  easypaisaEnabled?: boolean;
  easypaisaStoreId?: string;
  easypaisaHashKey?: string;
  easypaisaSandboxMode?: boolean;
  // ── PayFast (South Africa) ────────────────────────────────────
  payFastEnabled?: boolean;
  payFastMerchantId?: string;
  payFastMerchantKey?: string;
  payFastPassphrase?: string;
  payFastSandboxMode?: boolean;
  cardPaymentEnabled: boolean;

  shippingFee: number;
  taxPercentage: number;
  // Optional subtext shown under each payment logo button (empty = hidden)
  codSubtext?: string;
  bKashSubtext?: string;
  nagadSubtext?: string;
  rocketSubtext?: string;
  bankSubtext?: string;
  creditManualSubtext?: string;
  paypalSubtext?: string;
  stripeSubtext?: string;
  bKashAutoSubtext?: string;
  nagadAutoSubtext?: string;
  sslCommerzSubtext?: string;
  razorpaySubtext?: string;

  // Per-method button accent colors (hex, e.g. '#7c3aed')
  codBtnColor?: string;
  bKashBtnColor?: string;
  nagadBtnColor?: string;
  rocketBtnColor?: string;
  bankBtnColor?: string;
  creditManualBtnColor?: string;
  paypalBtnColor?: string;
  stripeBtnColor?: string;
  bKashAutoBtnColor?: string;
  nagadAutoBtnColor?: string;
}

export interface AdminCredentials {
  username: string;
  email?: string;
  password?: string;
  passwordHash?: string;
  googleSignInEnabled?: boolean;
  googleClientId?: string;
  recaptchaEnabled?: boolean;       // toggle reCAPTCHA on signup/login/checkout
  recaptchaSiteKey?: string;        // Google reCAPTCHA v2 site key
}

export interface SupportSettings {
  tawkToId: string;
  isEnabled: boolean;
}

export interface Category {
  id: string;
  name: string;
  emoji: string;
  slug: string;
  isVisible: boolean; // Admin can toggle visibility on storefront
  isNavbarFeatured?: boolean; // Admin can pin to navbar featured strip
  imageUrl?: string; // Optional uploaded logo image (overrides emoji when set)
}

export interface UserProfile {
  id?: string; // Firestore document ID — optional for backward compat with localStorage
  name: string;
  email: string;
  phone: string;
  phoneKey?: string;
  address: string;
  city: string;
  passwordHash?: string;
  orderIds?: string[]; // IDs of orders placed by this user
  passwordSetupSentAt?: string;
}

export interface SMSSettings {
  isEnabled: boolean;
  provider: 'twilio'; // extensible
  /**
   * Which channel to deliver OTPs over. Admin can switch at any time.
   *   'sms'      → classic SMS via Twilio Programmable Messaging
   *   'whatsapp' → Twilio WhatsApp API (uses whatsappFromNumber)
   */
  channel?: 'sms' | 'whatsapp';
  accountSid: string;
  authToken: string;
  fromNumber: string;            // SMS sender, e.g. +15550001234
  whatsappFromNumber?: string;   // WhatsApp sender, e.g. +14155238886
  // OTP config
  otpEnabled: boolean;
  otpExpiryMinutes: number;
  otpMessageTemplate: string; // supports {{code}}, {{store}}, {{expiry}}
  /** When true, the checkout page requires a verified OTP before placing the order. */
  requireOtpAtCheckout?: boolean;
}

export interface EmailVerificationSettings {
  isEnabled: boolean;
  requireVerificationBeforeOrder: boolean;
  tokenExpiryHours: number;
  otpSignInVerification?: boolean; // NEW: Require OTP verification when users sign in
}

export interface DeliveryZone {
  id: string;
  name: string;
  keywords: string[]; // lowercase city/area keywords
  fee: number;
  minDays: number;
  maxDays: number;
  isEnabled: boolean;
  /**
   * When true and the customer selects COD, the delivery fee must be paid
   * upfront via an existing payment gateway before the order is confirmed.
   * Admins configure this per-zone in Admin → Delivery Zones.
   */
  requireDeliveryFeePrepayment?: boolean;
  /**
   * Optional custom upfront amount (Partial COD) the customer must pay online
   * before the rest is collected on delivery. When undefined, the delivery
   * fee is used as the upfront amount. Per-zone so admins can charge a
   * heavier advance in higher-risk areas.
   */
  partialCodAmount?: number;
}
