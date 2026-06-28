/**
 * ISO-4217 currency-code → display symbol map.
 *
 * Used as a fallback when `siteSettings.currencySymbol` is unset, so any
 * country (not only Bangladeshi ৳) gets a sensible native-looking symbol.
 */

export const CURRENCY_SYMBOLS: Record<string, string> = {
  BDT: '৳', INR: '₹', PKR: '₨', LKR: 'Rs', NPR: 'Rs',
  USD: '$', CAD: 'C$', AUD: 'A$', NZD: 'NZ$', SGD: 'S$', HKD: 'HK$', TWD: 'NT$', MXN: 'Mex$',
  ARS: '$', CLP: '$', COP: '$', BRL: 'R$', PEN: 'S/',
  EUR: '€', GBP: '£', CHF: 'CHF', SEK: 'kr', NOK: 'kr', DKK: 'kr', PLN: 'zł', CZK: 'Kč',
  RUB: '₽', UAH: '₴', TRY: '₺',
  JPY: '¥', CNY: '¥', KRW: '₩', VND: '₫', THB: '฿', IDR: 'Rp', MYR: 'RM', PHP: '₱',
  AED: 'د.إ', SAR: '﷼', QAR: '﷼', KWD: 'د.ك', BHD: '.د.ب', OMR: 'ر.ع.',
  EGP: 'E£', ILS: '₪', ZAR: 'R', NGN: '₦', KES: 'KSh', MAD: 'د.م.',
};

export function getCurrencySymbol(code?: string | null, fallback = '$'): string {
  if (!code) return fallback;
  return CURRENCY_SYMBOLS[code.toUpperCase()] || code.toUpperCase() + ' ';
}

/** Resolve symbol from siteSettings, preferring an explicit override. */
export function resolveCurrencySymbol(
  settings?: { currencySymbol?: string | null; currency?: string | null } | null,
  fallback = '$',
): string {
  const explicit = settings?.currencySymbol?.trim();
  if (explicit) return explicit;
  return getCurrencySymbol(settings?.currency, fallback);
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT METHOD → NATIVE CURRENCY MAP
// When the store currency differs from the currency a payment method natively
// processes, we must convert the amount so the customer pays the correct
// local-currency value.
// ─────────────────────────────────────────────────────────────────────────────

/** Which native currency each payment method operates in */
export const PAYMENT_METHOD_NATIVE_CURRENCY: Record<string, string> = {
  bKash:      'BDT',
  bKashAuto:  'BDT',
  Nagad:      'BDT',
  NagadAuto:  'BDT',
  Rocket:     'BDT',
  SSLCommerz: 'BDT',
  Razorpay:   'INR',
  Paytm:      'INR',
  UPI:        'INR',
  JazzCash:   'PKR',
  Easypaisa:  'PKR',
  PayFast:    'ZAR',
  // International gateways that handle multi-currency themselves:
  Stripe:     null,   // Stripe converts server-side
  PayPal:     null,   // PayPal converts server-side
  // Manual / COD always in store currency
  COD:        null,
  Bank:       null,
  CreditManual: null,
};

/** Simple in-memory cache for exchange rates (keyed as "FROM_TO") */
const rateCache: Record<string, { rate: number; ts: number }> = {};
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch live exchange rate from → to.
 * Uses multiple free public APIs in priority order, no API key required.
 * Results are cached for 10 minutes to avoid hammering the APIs.
 */
export async function fetchExchangeRate(from: string, to: string): Promise<number> {
  const FROM = from.toUpperCase();
  const TO = to.toUpperCase();
  if (!FROM || !TO || FROM === TO) return 1;

  const key = `${FROM}_${TO}`;
  const cached = rateCache[key];
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.rate;

  const save = (rate: number) => { rateCache[key] = { rate, ts: Date.now() }; return rate; };

  // 1. cdn.jsdelivr.net mirrors frankfurter — fast, no key, reliable CDN
  try {
    const res = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${FROM.toLowerCase()}.json`);
    if (res.ok) {
      const data = await res.json();
      const rate = data?.[FROM.toLowerCase()]?.[TO.toLowerCase()];
      if (rate && typeof rate === 'number' && rate > 0) return save(rate);
    }
  } catch { /* try next */ }

  // 2. Frankfurter (ECB-backed, very reliable, covers major currencies)
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${FROM}&to=${TO}`);
    if (res.ok) {
      const data = await res.json();
      const rate = data?.rates?.[TO];
      if (rate && typeof rate === 'number' && rate > 0) return save(rate);
    }
  } catch { /* try next */ }

  // 3. open.er-api.com (free tier, no key for latest rates)
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${FROM}`);
    if (res.ok) {
      const data = await res.json();
      const rate = data?.rates?.[TO];
      if (rate && typeof rate === 'number' && rate > 0) return save(rate);
    }
  } catch { /* try next */ }

  // All APIs failed — return 1 (no conversion, safe fallback)
  console.warn(`[Currency] Could not fetch ${FROM}→${TO} rate, showing unconverted amount`);
  return 1;
}

/**
 * Convert an amount from the store currency to the payment method's native
 * currency. Returns { convertedAmount, nativeCurrency, rate }.
 * If no conversion needed returns the original amount and storeCurrency.
 */
export async function convertForPaymentMethod(
  amount: number,
  storeCurrency: string,
  paymentMethodId: string,
): Promise<{ convertedAmount: number; nativeCurrency: string; rate: number }> {
  const nativeCurrency = PAYMENT_METHOD_NATIVE_CURRENCY[paymentMethodId];
  if (!nativeCurrency) {
    // Gateway handles conversion itself (Stripe/PayPal) or same currency
    return { convertedAmount: amount, nativeCurrency: storeCurrency, rate: 1 };
  }
  if (nativeCurrency.toUpperCase() === storeCurrency.toUpperCase()) {
    return { convertedAmount: amount, nativeCurrency, rate: 1 };
  }
  const rate = await fetchExchangeRate(storeCurrency, nativeCurrency);
  return {
    convertedAmount: Math.round(amount * rate * 100) / 100,
    nativeCurrency,
    rate,
  };
}
