// src/components/paymentClient.ts
// Drop-in helpers used by CartModal for each Auto gateway.
// Import and call from CartModal's `handlePlaceOrder` switch.

export type OrderBasics = {
  orderId: string;
  amount: number;
  customer: {
    name: string;
    email: string;
    phone: string;
    address?: string;
    city?: string;
    country?: string;
  };
  productName?: string;
};

// ---- bKash (already shipped in v2, kept here for parity) ----
export async function startBkash(o: OrderBasics): Promise<void> {
  const r = await fetch('/api/bkash/create-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: o.amount, orderId: o.orderId }),
  });
  const j = await r.json();
  if (!r.ok || !j?.bkashURL) throw new Error(j?.error || 'bKash init failed');
  // Persist pending order BEFORE redirect (handled in CartModal already)
  window.location.href = j.bkashURL;
}

// ---- Nagad (Auto) ----
export async function startNagad(o: OrderBasics): Promise<void> {
  const r = await fetch('/api/nagad/create-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: o.amount, orderId: o.orderId }),
  });
  const j = await r.json();
  if (!r.ok || !j?.callBackUrl) throw new Error(j?.error || 'Nagad init failed');
  window.location.href = j.callBackUrl;
}

// ---- SSLCommerz (Auto) ----
export async function startSSLCommerz(o: OrderBasics): Promise<void> {
  const r = await fetch('/api/sslcommerz/create-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: o.amount,
      orderId: o.orderId,
      customer: o.customer,
      productName: o.productName,
    }),
  });
  const j = await r.json();
  if (!r.ok || !j?.redirectUrl) throw new Error(j?.error || 'SSLCommerz init failed');
  window.location.href = j.redirectUrl;
}

// ---- Razorpay (Auto) ----
declare global {
  interface Window {
    Razorpay?: any;
    Stripe?: any;
  }
}
function loadRzpScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Razorpay'));
    document.body.appendChild(s);
  });
}

function loadStripeScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Stripe) return resolve();
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Stripe'));
    document.body.appendChild(s);
  });
}

export async function startRazorpay(
  o: OrderBasics,
  onSuccess: (p: { paymentId: string; orderId: string; signature: string }) => Promise<void> | void,
  onFailure?: (err: any) => void,
): Promise<void> {
  const r = await fetch('/api/razorpay/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: o.amount, currency: 'INR', receipt: o.orderId }),
  });
  const j = await r.json();
  if (!r.ok || !j?.orderId || !j?.keyId) throw new Error(j?.error || 'Razorpay order failed');

  await loadRzpScript();
  const rzp = new window.Razorpay({
    key: j.keyId,
    amount: j.amount,
    currency: j.currency,
    order_id: j.orderId,
    name: o.productName || 'Frutopia',
    prefill: { name: o.customer.name, email: o.customer.email, contact: o.customer.phone },
    handler: async (resp: any) => {
      const v = await fetch('/api/razorpay/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: resp.razorpay_order_id,
          razorpay_payment_id: resp.razorpay_payment_id,
          razorpay_signature: resp.razorpay_signature,
        }),
      }).then((x) => x.json());
      if (!v?.success) return onFailure?.(new Error('Signature verification failed'));
      await onSuccess({
        paymentId: resp.razorpay_payment_id,
        orderId: resp.razorpay_order_id,
        signature: resp.razorpay_signature,
      });
    },
    modal: { ondismiss: () => onFailure?.(new Error('Razorpay closed')) },
  });
  rzp.open();
}

// ---- Stripe (Auto) ----
export async function startStripe(
  o: OrderBasics,
  publishableKey: string,
  _onSuccess: (p: { paymentIntentId: string; status: string }) => Promise<void> | void,
  onFailure?: (err: any) => void,
): Promise<void> {
  try {
    // Create a Stripe Checkout Session server-side and redirect to the hosted page.
    // (PaymentIntent client_secret cannot be passed to redirectToCheckout — that
    // API requires a Checkout Session ID.)
    const r = await fetch('/api/stripe/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: o.amount,
        currency: 'usd',
        orderId: o.orderId,
        productName: o.productName || 'Order',
        customerEmail: o.customer.email,
        successUrl: `${window.location.origin}/?payment=success&orderId=${encodeURIComponent(o.orderId)}`,
        cancelUrl: `${window.location.origin}/?payment=cancelled&orderId=${encodeURIComponent(o.orderId)}`,
      }),
    });
    const data = await r.json();
    if (!r.ok || (!data?.url && !data?.sessionId)) {
      throw new Error(data?.error || 'Stripe Checkout session failed');
    }

    if (data.url) {
      window.location.href = data.url;
      return;
    }

    await loadStripeScript();
    const stripe = window.Stripe!(publishableKey);
    if (!stripe) throw new Error('Stripe failed to initialize');
    const { error } = await stripe.redirectToCheckout({ sessionId: data.sessionId });
    if (error) onFailure?.(new Error(error.message));
  } catch (err: any) {
    onFailure?.(err);
  }
}

// ---- PayPal (Auto) ----
export async function startPayPal(
  o: OrderBasics,
  onSuccess: (p: { orderId: string; payerId: string }) => Promise<void> | void,
  onFailure?: (err: any) => void,
): Promise<void> {
  try {
    const r = await fetch('/api/paypal/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: o.amount, currency: 'USD' }),
    });
    const data = await r.json();
    if (!r.ok || !data?.approvalUrl) {
      throw new Error(data?.error || 'PayPal order creation failed');
    }

    // Redirect to PayPal for approval
    window.location.href = data.approvalUrl;
  } catch (err: any) {
    onFailure?.(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW GATEWAYS (added v5.7): Paytm, UPI (manual), JazzCash, Easypaisa, PayFast.
// Each helper builds the gateway-specific payload from settings the admin
// configured in CMS → Settings → Checkout Channels and redirects accordingly.
// ─────────────────────────────────────────────────────────────────────────────

type PayCreds = Record<string, any>;

function postForm(action: string, fields: Record<string, string>) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;
  for (const [k, v] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = v ?? '';
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

// ---- Paytm (India) ----
export async function startPaytm(o: OrderBasics, creds: PayCreds): Promise<void> {
  const r = await fetch('/api/paytm/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: o.amount,
      orderId: o.orderId,
      customer: o.customer,
      merchantId: creds.merchantId,
      merchantKey: creds.merchantKey,
      sandboxMode: creds.sandboxMode,
    }),
  });
  const j = await r.json();
  if (!r.ok || !j?.redirectUrl) throw new Error(j?.error || 'Paytm init failed');
  // Paytm wants a POST with txnToken
  postForm(j.redirectUrl, { txnToken: j.txnToken, mid: j.mid, orderId: j.orderId });
}

// ---- UPI manual ----
// Returns the upi:// deep link + QR payload. Caller renders QR / "Open UPI app".
export async function startUPI(
  o: OrderBasics,
  creds: PayCreds,
): Promise<{ intent: string; qrPayload: string }> {
  const r = await fetch('/api/upi/create-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: o.amount,
      orderId: o.orderId,
      upiId: creds.upiId,
      payeeName: creds.payeeName,
      note: o.productName,
    }),
  });
  const j = await r.json();
  if (!r.ok || !j?.intent) throw new Error(j?.error || 'UPI intent failed');
  return { intent: j.intent, qrPayload: j.qrPayload };
}

// ---- JazzCash (Pakistan) ----
export async function startJazzCash(o: OrderBasics, creds: PayCreds): Promise<void> {
  const r = await fetch('/api/jazzcash/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: o.amount,
      orderId: o.orderId,
      customer: o.customer,
      merchantId: creds.merchantId,
      password: creds.password,
      integritySalt: creds.integritySalt,
      sandboxMode: creds.sandboxMode,
    }),
  });
  const j = await r.json();
  if (!r.ok || !j?.postUrl) throw new Error(j?.error || 'JazzCash init failed');
  postForm(j.postUrl, j.fields);
}

// ---- Easypaisa (Pakistan) ----
export async function startEasypaisa(o: OrderBasics, creds: PayCreds): Promise<void> {
  const r = await fetch('/api/easypaisa/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: o.amount,
      orderId: o.orderId,
      customer: o.customer,
      storeId: creds.storeId,
      hashKey: creds.hashKey,
      sandboxMode: creds.sandboxMode,
    }),
  });
  const j = await r.json();
  if (!r.ok || !j?.redirectUrl) throw new Error(j?.error || 'Easypaisa init failed');
  window.location.href = j.redirectUrl;
}

// ---- PayFast (South Africa) ----
export async function startPayFast(o: OrderBasics, creds: PayCreds): Promise<void> {
  const r = await fetch('/api/payfast/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: o.amount,
      orderId: o.orderId,
      customer: o.customer,
      productName: o.productName,
      merchantId: creds.merchantId,
      merchantKey: creds.merchantKey,
      passphrase: creds.passphrase,
      sandboxMode: creds.sandboxMode,
    }),
  });
  const j = await r.json();
  if (!r.ok || !j?.postUrl) throw new Error(j?.error || 'PayFast init failed');
  postForm(j.postUrl, j.fields);
}
