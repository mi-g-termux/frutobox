/**
 * Country-aware phone number validation.
 *
 * Each rule defines the allowed length(s) of the *local* (national) part —
 * the digits AFTER the international dial code — plus the ISO-3166 alpha-2
 * short code (BD, IN, US…) and the country's primary ISO-4217 currency.
 *
 * `iso` is what the checkout dropdown's selected pill shows (compact);
 * `name` is what the open list shows (full).
 */

export interface CountryPhoneRule {
  dial: string;
  name: string;
  /** ISO-3166 alpha-2 country code, e.g. "BD", "IN". */
  iso: string;
  /** Primary ISO-4217 currency code, e.g. "BDT", "INR". */
  currency: string;
  /** Allowed lengths of the local number, without the dial code. */
  lengths: number[];
  pattern?: RegExp;
  stripLeadingZero?: boolean;
}

export const COUNTRY_PHONE_RULES: CountryPhoneRule[] = [
  { dial: '+880', iso: 'BD', currency: 'BDT', name: 'Bangladesh',     lengths: [10],     pattern: /^1[3-9]\d{8}$/, stripLeadingZero: true },
  { dial: '+91',  iso: 'IN', currency: 'INR', name: 'India',          lengths: [10],     pattern: /^[6-9]\d{9}$/ },
  { dial: '+92',  iso: 'PK', currency: 'PKR', name: 'Pakistan',       lengths: [10],     pattern: /^3\d{9}$/, stripLeadingZero: true },
  { dial: '+1',   iso: 'US', currency: 'USD', name: 'USA / Canada',   lengths: [10],     pattern: /^[2-9]\d{2}[2-9]\d{6}$/ },
  { dial: '+44',  iso: 'GB', currency: 'GBP', name: 'United Kingdom', lengths: [10],     pattern: /^7\d{9}$/, stripLeadingZero: true },
  { dial: '+971', iso: 'AE', currency: 'AED', name: 'UAE',            lengths: [9],      pattern: /^5\d{8}$/, stripLeadingZero: true },
  { dial: '+966', iso: 'SA', currency: 'SAR', name: 'Saudi Arabia',   lengths: [9],      pattern: /^5\d{8}$/, stripLeadingZero: true },
  { dial: '+974', iso: 'QA', currency: 'QAR', name: 'Qatar',          lengths: [8] },
  { dial: '+965', iso: 'KW', currency: 'KWD', name: 'Kuwait',         lengths: [8] },
  { dial: '+973', iso: 'BH', currency: 'BHD', name: 'Bahrain',        lengths: [8] },
  { dial: '+968', iso: 'OM', currency: 'OMR', name: 'Oman',           lengths: [8] },
  { dial: '+60',  iso: 'MY', currency: 'MYR', name: 'Malaysia',       lengths: [9, 10],  stripLeadingZero: true },
  { dial: '+65',  iso: 'SG', currency: 'SGD', name: 'Singapore',      lengths: [8] },
  { dial: '+62',  iso: 'ID', currency: 'IDR', name: 'Indonesia',      lengths: [9, 10, 11, 12], stripLeadingZero: true },
  { dial: '+66',  iso: 'TH', currency: 'THB', name: 'Thailand',       lengths: [9],      stripLeadingZero: true },
  { dial: '+84',  iso: 'VN', currency: 'VND', name: 'Vietnam',        lengths: [9, 10],  stripLeadingZero: true },
  { dial: '+63',  iso: 'PH', currency: 'PHP', name: 'Philippines',    lengths: [10],     stripLeadingZero: true },
  { dial: '+86',  iso: 'CN', currency: 'CNY', name: 'China',          lengths: [11] },
  { dial: '+81',  iso: 'JP', currency: 'JPY', name: 'Japan',          lengths: [10, 11], stripLeadingZero: true },
  { dial: '+82',  iso: 'KR', currency: 'KRW', name: 'South Korea',    lengths: [9, 10],  stripLeadingZero: true },
  { dial: '+852', iso: 'HK', currency: 'HKD', name: 'Hong Kong',      lengths: [8] },
  { dial: '+886', iso: 'TW', currency: 'TWD', name: 'Taiwan',         lengths: [9],      stripLeadingZero: true },
  { dial: '+61',  iso: 'AU', currency: 'AUD', name: 'Australia',      lengths: [9],      stripLeadingZero: true },
  { dial: '+64',  iso: 'NZ', currency: 'NZD', name: 'New Zealand',    lengths: [8, 9, 10], stripLeadingZero: true },
  { dial: '+49',  iso: 'DE', currency: 'EUR', name: 'Germany',        lengths: [10, 11], stripLeadingZero: true },
  { dial: '+33',  iso: 'FR', currency: 'EUR', name: 'France',         lengths: [9],      stripLeadingZero: true },
  { dial: '+39',  iso: 'IT', currency: 'EUR', name: 'Italy',          lengths: [9, 10] },
  { dial: '+34',  iso: 'ES', currency: 'EUR', name: 'Spain',          lengths: [9] },
  { dial: '+31',  iso: 'NL', currency: 'EUR', name: 'Netherlands',    lengths: [9],      stripLeadingZero: true },
  { dial: '+32',  iso: 'BE', currency: 'EUR', name: 'Belgium',        lengths: [9],      stripLeadingZero: true },
  { dial: '+41',  iso: 'CH', currency: 'CHF', name: 'Switzerland',    lengths: [9],      stripLeadingZero: true },
  { dial: '+43',  iso: 'AT', currency: 'EUR', name: 'Austria',        lengths: [10, 11], stripLeadingZero: true },
  { dial: '+46',  iso: 'SE', currency: 'SEK', name: 'Sweden',         lengths: [9],      stripLeadingZero: true },
  { dial: '+47',  iso: 'NO', currency: 'NOK', name: 'Norway',         lengths: [8] },
  { dial: '+45',  iso: 'DK', currency: 'DKK', name: 'Denmark',        lengths: [8] },
  { dial: '+358', iso: 'FI', currency: 'EUR', name: 'Finland',        lengths: [9, 10],  stripLeadingZero: true },
  { dial: '+351', iso: 'PT', currency: 'EUR', name: 'Portugal',       lengths: [9] },
  { dial: '+353', iso: 'IE', currency: 'EUR', name: 'Ireland',        lengths: [9],      stripLeadingZero: true },
  { dial: '+30',  iso: 'GR', currency: 'EUR', name: 'Greece',         lengths: [10] },
  { dial: '+48',  iso: 'PL', currency: 'PLN', name: 'Poland',         lengths: [9] },
  { dial: '+420', iso: 'CZ', currency: 'CZK', name: 'Czechia',        lengths: [9] },
  { dial: '+90',  iso: 'TR', currency: 'TRY', name: 'Turkey',         lengths: [10],     stripLeadingZero: true },
  { dial: '+7',   iso: 'RU', currency: 'RUB', name: 'Russia',         lengths: [10] },
  { dial: '+380', iso: 'UA', currency: 'UAH', name: 'Ukraine',        lengths: [9] },
  { dial: '+972', iso: 'IL', currency: 'ILS', name: 'Israel',         lengths: [9],      stripLeadingZero: true },
  { dial: '+20',  iso: 'EG', currency: 'EGP', name: 'Egypt',          lengths: [10],     stripLeadingZero: true },
  { dial: '+27',  iso: 'ZA', currency: 'ZAR', name: 'South Africa',   lengths: [9],      stripLeadingZero: true },
  { dial: '+234', iso: 'NG', currency: 'NGN', name: 'Nigeria',        lengths: [10],     stripLeadingZero: true },
  { dial: '+254', iso: 'KE', currency: 'KES', name: 'Kenya',          lengths: [9],      stripLeadingZero: true },
  { dial: '+212', iso: 'MA', currency: 'MAD', name: 'Morocco',        lengths: [9],      stripLeadingZero: true },
  { dial: '+55',  iso: 'BR', currency: 'BRL', name: 'Brazil',         lengths: [10, 11] },
  { dial: '+52',  iso: 'MX', currency: 'MXN', name: 'Mexico',         lengths: [10] },
  { dial: '+54',  iso: 'AR', currency: 'ARS', name: 'Argentina',      lengths: [10] },
  { dial: '+56',  iso: 'CL', currency: 'CLP', name: 'Chile',          lengths: [9] },
  { dial: '+57',  iso: 'CO', currency: 'COP', name: 'Colombia',       lengths: [10] },
  { dial: '+51',  iso: 'PE', currency: 'PEN', name: 'Peru',           lengths: [9] },
];

export const DEFAULT_RULE: CountryPhoneRule = {
  dial: '',
  iso: '',
  currency: 'USD',
  name: 'Generic',
  lengths: [6, 7, 8, 9, 10, 11, 12, 13, 14],
};

export function findRule(dial: string): CountryPhoneRule {
  return COUNTRY_PHONE_RULES.find(r => r.dial === dial) || { ...DEFAULT_RULE, dial };
}

// ─── Validation helpers (unchanged from original) ──────────────────────────

export interface PhoneValidationResult {
  ok: boolean;
  e164: string;
  error?: string;
}

export function validatePhone(dial: string, local: string): PhoneValidationResult {
  const rule = findRule(dial);
  let digits = (local || '').replace(/\D/g, '');
  if (rule.stripLeadingZero && digits.startsWith('0')) digits = digits.slice(1);

  if (!digits) return { ok: false, e164: '', error: 'Phone number is required.' };
  if (!rule.lengths.includes(digits.length)) {
    const expected = rule.lengths.join(' or ');
    return { ok: false, e164: '', error: `${rule.name || 'This country'} numbers must be ${expected} digits.` };
  }
  if (rule.pattern && !rule.pattern.test(digits)) {
    return { ok: false, e164: '', error: `Invalid ${rule.name || 'phone'} number format.` };
  }
  return { ok: true, e164: `${dial}${digits}` };
}

export function toE164(dial: string, local: string): string {
  const r = validatePhone(dial, local);
  return r.ok ? r.e164 : `${dial}${(local || '').replace(/\D/g, '')}`;
}
