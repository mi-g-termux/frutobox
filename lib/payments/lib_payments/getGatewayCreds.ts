// lib/payments/lib_payments/getGatewayCreds.ts
// Reads gateway credentials from environment variables ONLY.
// No firebase-admin dependency — works reliably on Vercel's serverless runtime.
//
// ENV var names match what AdminPanel saves / what you set in Vercel Project
// Settings → Environment Variables (Production + Preview).

/**
 * Returns gateway credentials reading strictly from process.env.
 * gateway = 'nagad' | 'sslcommerz' | 'razorpay' | 'bkash' | 'stripe' | 'paypal'
 */
export async function getGatewayCreds(gateway: string): Promise<Record<string, string>> {
  const pick = (envKey: string): string =>
    process.env[envKey] ? String(process.env[envKey]).trim() : '';

  switch (gateway) {
    case 'stripe':
      return {
        secretKey:  pick('STRIPE_SECRET_KEY'),
        publicKey:  pick('STRIPE_PUBLIC_KEY'),
        isSandbox:  pick('STRIPE_SANDBOX') || 'true',
      };

    case 'paypal':
      return {
        clientId:     pick('PAYPAL_CLIENT_ID'),
        clientSecret: pick('PAYPAL_CLIENT_SECRET'),
        isSandbox:    pick('PAYPAL_SANDBOX') || 'true',
      };

    case 'sslcommerz':
      return {
        storeId:   pick('SSLCZ_STORE_ID'),
        storePass: pick('SSLCZ_STORE_PASSWORD'),
        isSandbox: pick('SSLCZ_SANDBOX')         || 'true',
      };

    case 'nagad':
      return {
        merchantId:     pick('NAGAD_MERCHANT_ID'),
        merchantNumber: pick('NAGAD_MERCHANT_NUMBER'),
        publicKey:      pick('NAGAD_PUBLIC_KEY'),
        privateKey:     pick('NAGAD_PRIVATE_KEY'),
        baseUrl:        pick('NAGAD_BASE_URL') ||
                        'https://api.mynagad.com/api/dfs',
        callbackUrl:    pick('NAGAD_CALLBACK_URL'),
        isSandbox:      pick('NAGAD_SANDBOX') || 'true',
      };

    case 'razorpay':
      return {
        keyId:     pick('RAZORPAY_KEY_ID'),
        keySecret: pick('RAZORPAY_KEY_SECRET'),
        isSandbox: pick('RAZORPAY_SANDBOX') || 'false',
      };

    case 'bkash':
      return {
        appKey:   pick('BKASH_APP_KEY'),
        appSecret:pick('BKASH_APP_SECRET'),
        username: pick('BKASH_USERNAME'),
        password: pick('BKASH_PASSWORD'),
        baseUrl:  pick('BKASH_BASE_URL') ||
                  'https://tokenized.pay.bka.sh/v1.2.0-beta',
        isSandbox:pick('BKASH_SANDBOX') || 'true',
      };

    default:
      return {};
  }
}

export function missingCreds(creds: Record<string, string>, required: string[]): string[] {
  return required.filter((k) => !creds[k]);
}
