import React from 'react';

interface LogoProps { className?: string }

function LogoImg({
  src, alt, className = 'h-8',
}: { src: string; alt: string; className?: string }) {
  const [err, setErr] = React.useState(false);
  if (err) {
    return (
      <span className="font-bold text-xs tracking-wide text-slate-700">{alt}</span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={`w-auto object-contain ${className}`}
      onError={() => setErr(true)}
      loading="lazy"
      decoding="async"
    />
  );
}

export const StripeLogo:        React.FC<LogoProps> = ({ className = 'h-7' }) => <LogoImg src="/logos/stripe.png"      alt="Stripe"      className={className} />;
export const PaypalLogo:        React.FC<LogoProps> = ({ className = 'h-7' }) => <LogoImg src="/logos/paypal.png"      alt="PayPal"      className={className} />;
export const RazorpayLogo:      React.FC<LogoProps> = ({ className = 'h-7' }) => <LogoImg src="/logos/razorpay.png"    alt="Razorpay"    className={className} />;
export const SSLCommerzLogo:    React.FC<LogoProps> = ({ className = 'h-7' }) => <LogoImg src="/logos/sslcommerz.png"  alt="SSLCommerz"  className={className} />;
export const BkashLogo:         React.FC<LogoProps> = ({ className = 'h-7' }) => <LogoImg src="/logos/bkash.png"       alt="bKash"       className={className} />;
export const NagadLogo:         React.FC<LogoProps> = ({ className = 'h-7' }) => <LogoImg src="/logos/nagad.png"       alt="Nagad"       className={className} />;
export const RocketLogo:        React.FC<LogoProps> = ({ className = 'h-7' }) => <LogoImg src="/logos/rocket.png"      alt="Rocket"      className={className} />;
export const JazzCashLogo:      React.FC<LogoProps> = ({ className = 'h-7' }) => <LogoImg src="/logos/jazzcash.png"    alt="JazzCash"    className={className} />;
export const EasypaisaLogo:     React.FC<LogoProps> = ({ className = 'h-7' }) => <LogoImg src="/logos/easypaisa.png"   alt="Easypaisa"   className={className} />;
export const UpiLogo:           React.FC<LogoProps> = ({ className = 'h-7' }) => <LogoImg src="/logos/upi.png"         alt="UPI"         className={className} />;
export const PaytmLogo:         React.FC<LogoProps> = ({ className = 'h-7' }) => <LogoImg src="/logos/paytm.png"       alt="Paytm"       className={className} />;
export const PayfastLogo:       React.FC<LogoProps> = ({ className = 'h-7' }) => <LogoImg src="/logos/payfast.png"     alt="PayFast"     className={className} />;

export const BankTransferLogo: React.FC<LogoProps> = ({ className = 'h-8' }) => (
  <svg className={className} viewBox="0 0 180 52" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="30" width="6"  height="10" rx="1" fill="#1e40af" fillOpacity="0.85"/>
    <rect x="13" y="23" width="6"  height="17" rx="1" fill="#1e40af" fillOpacity="0.85"/>
    <rect x="22" y="26" width="6"  height="14" rx="1" fill="#1e40af" fillOpacity="0.85"/>
    <rect x="31" y="21" width="6"  height="19" rx="1" fill="#1e40af" fillOpacity="0.85"/>
    <rect x="2"  y="41" width="38" height="3"  rx="1.5" fill="#1e40af" fillOpacity="0.85"/>
    <polygon points="1,19 21,8 42,19" fill="#1e40af" fillOpacity="0.9"/>
    <text x="52" y="24" fill="#1e293b" fontFamily="system-ui,sans-serif" fontSize="13" fontWeight="800">Bank</text>
    <text x="52" y="40" fill="#1e293b" fontFamily="system-ui,sans-serif" fontSize="13" fontWeight="800">Transfer</text>
  </svg>
);

export const CodLogo: React.FC<LogoProps> = ({ className = 'h-8' }) => (
  <svg className={className} viewBox="0 0 180 52" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4"  y="12" width="42" height="26" rx="4" fill="none" stroke="#059669" strokeWidth="2.5" strokeOpacity="0.9"/>
    <circle cx="25" cy="25" r="7" fill="none" stroke="#059669" strokeWidth="2" strokeOpacity="0.9"/>
    <line x1="4"  y1="19" x2="46" y2="19" stroke="#059669" strokeOpacity="0.35" strokeWidth="1.5"/>
    <line x1="4"  y1="31" x2="46" y2="31" stroke="#059669" strokeOpacity="0.35" strokeWidth="1.5"/>
    <text x="21" y="29" fill="#059669" fontFamily="Arial Black,sans-serif" fontSize="10" fontWeight="900">৳</text>
    <text x="56" y="24" fill="#1e293b" fontFamily="system-ui,sans-serif" fontSize="12" fontWeight="800">Cash on</text>
    <text x="56" y="40" fill="#1e293b" fontFamily="system-ui,sans-serif" fontSize="12" fontWeight="800">Delivery</text>
  </svg>
);

export const ManualCardsLogo: React.FC<LogoProps> = ({ className = 'h-8' }) => (
  <svg className={className} viewBox="0 0 180 52" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="16" y="8"  width="32" height="22" rx="4" fill="none" stroke="#475569" strokeWidth="2" strokeOpacity="0.5"/>
    <rect x="12" y="12" width="32" height="22" rx="4" fill="none" stroke="#475569" strokeWidth="2" strokeOpacity="0.7"/>
    <rect x="8"  y="16" width="32" height="22" rx="4" fill="#f1f5f9"/>
    <line x1="8"  y1="23" x2="40" y2="23" stroke="#475569" strokeOpacity="0.7" strokeWidth="2.5"/>
    <rect x="12" y="28" width="10" height="4" rx="1" fill="#475569" fillOpacity="0.55"/>
    <text x="52" y="26" fill="#1e293b" fontFamily="system-ui,sans-serif" fontSize="12" fontWeight="800">Manual</text>
    <text x="52" y="42" fill="#1e293b" fontFamily="system-ui,sans-serif" fontSize="12" fontWeight="800">Card Ref</text>
  </svg>
);

export const VisaMastercardLogo: React.FC<LogoProps> = ({ className = 'h-8' }) => (
  <svg className={className} viewBox="0 0 220 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="12" y="18" width="18" height="14" rx="3" fill="#C9A227" fillOpacity="0.9"/>
    <rect x="15" y="21" width="12" height="8" rx="1.5" fill="#0F172A" fillOpacity="0.5"/>
    <text x="36" y="35" fill="#1A56DB" fontFamily="Arial Black,system-ui,sans-serif" fontSize="18" fontWeight="900" letterSpacing="1.5">VISA</text>
    <line x1="108" y1="10" x2="108" y2="46" stroke="#cbd5e1" strokeWidth="1"/>
    <circle cx="128" cy="28" r="14" fill="#EB001B"/>
    <circle cx="148" cy="28" r="14" fill="#F79E1B"/>
    <path d="M138 17.1a14 14 0 010 21.8A14 14 0 01138 17.1z" fill="#FF5F00"/>
    <text x="166" y="33" fill="#64748b" fontFamily="system-ui,sans-serif" fontSize="10" fontWeight="700">MC</text>
  </svg>
);

export const QuirkyFruityLogo: React.FC<{ className?: string }> = ({ className = "w-9 h-9" }) => (
  <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bagGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#10b981"/>
        <stop offset="100%" stopColor="#059669"/>
      </linearGradient>
      <linearGradient id="handleGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#6ee7b7"/>
        <stop offset="100%" stopColor="#10b981"/>
      </linearGradient>
    </defs>
    <rect x="18" y="38" width="64" height="46" rx="7" fill="url(#bagGrad)"/>
    <rect x="18" y="38" width="64" height="14" rx="7" fill="#34d399" fillOpacity="0.45"/>
    <path d="M35 38 C35 22 65 22 65 38" stroke="url(#handleGrad)" strokeWidth="7" strokeLinecap="round" fill="none"/>
    <path d="M40 38 C40 28 60 28 60 38" stroke="#059669" strokeWidth="3" strokeLinecap="round" fill="none" fillOpacity="0.55"/>
    <rect x="38" y="58" width="24" height="14" rx="4" fill="white" fillOpacity="0.22"/>
    <path d="M74 24 L76 20 L78 24 L82 26 L78 28 L76 32 L74 28 L70 26 Z" fill="#fbbf24"/>
    <circle cx="66" cy="18" r="2.5" fill="#fbbf24" fillOpacity="0.75"/>
  </svg>
);
