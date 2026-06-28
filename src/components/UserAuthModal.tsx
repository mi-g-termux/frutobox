/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from './Toast';
import { X, User, LogIn, UserPlus, Eye, EyeOff, CheckCircle, AlertCircle, MapPin, Phone, Mail, Lock, ShoppingBag, ChevronRight, Package } from 'lucide-react';
import { Order } from '../types';

// Country dial codes for phone inputs (E.164). Ordered by region popularity.
const COUNTRY_CODES: { code: string; flag: string; name: string }[] = [
  { code: '+880', flag: '🇧🇩', name: 'Bangladesh' },
  { code: '+91',  flag: '🇮🇳', name: 'India' },
  { code: '+92',  flag: '🇵🇰', name: 'Pakistan' },
  { code: '+1',   flag: '🇺🇸', name: 'United States / Canada' },
  { code: '+44',  flag: '🇬🇧', name: 'United Kingdom' },
  { code: '+971', flag: '🇦🇪', name: 'UAE' },
  { code: '+966', flag: '🇸🇦', name: 'Saudi Arabia' },
  { code: '+974', flag: '🇶🇦', name: 'Qatar' },
  { code: '+965', flag: '🇰🇼', name: 'Kuwait' },
  { code: '+973', flag: '🇧🇭', name: 'Bahrain' },
  { code: '+968', flag: '🇴🇲', name: 'Oman' },
  { code: '+60',  flag: '🇲🇾', name: 'Malaysia' },
  { code: '+65',  flag: '🇸🇬', name: 'Singapore' },
  { code: '+62',  flag: '🇮🇩', name: 'Indonesia' },
  { code: '+66',  flag: '🇹🇭', name: 'Thailand' },
  { code: '+84',  flag: '🇻🇳', name: 'Vietnam' },
  { code: '+63',  flag: '🇵🇭', name: 'Philippines' },
  { code: '+86',  flag: '🇨🇳', name: 'China' },
  { code: '+81',  flag: '🇯🇵', name: 'Japan' },
  { code: '+82',  flag: '🇰🇷', name: 'South Korea' },
  { code: '+852', flag: '🇭🇰', name: 'Hong Kong' },
  { code: '+886', flag: '🇹🇼', name: 'Taiwan' },
  { code: '+61',  flag: '🇦🇺', name: 'Australia' },
  { code: '+64',  flag: '🇳🇿', name: 'New Zealand' },
  { code: '+49',  flag: '🇩🇪', name: 'Germany' },
  { code: '+33',  flag: '🇫🇷', name: 'France' },
  { code: '+39',  flag: '🇮🇹', name: 'Italy' },
  { code: '+34',  flag: '🇪🇸', name: 'Spain' },
  { code: '+31',  flag: '🇳🇱', name: 'Netherlands' },
  { code: '+32',  flag: '🇧🇪', name: 'Belgium' },
  { code: '+41',  flag: '🇨🇭', name: 'Switzerland' },
  { code: '+43',  flag: '🇦🇹', name: 'Austria' },
  { code: '+46',  flag: '🇸🇪', name: 'Sweden' },
  { code: '+47',  flag: '🇳🇴', name: 'Norway' },
  { code: '+45',  flag: '🇩🇰', name: 'Denmark' },
  { code: '+358', flag: '🇫🇮', name: 'Finland' },
  { code: '+351', flag: '🇵🇹', name: 'Portugal' },
  { code: '+353', flag: '🇮🇪', name: 'Ireland' },
  { code: '+30',  flag: '🇬🇷', name: 'Greece' },
  { code: '+48',  flag: '🇵🇱', name: 'Poland' },
  { code: '+420', flag: '🇨🇿', name: 'Czechia' },
  { code: '+90',  flag: '🇹🇷', name: 'Turkey' },
  { code: '+7',   flag: '🇷🇺', name: 'Russia' },
  { code: '+380', flag: '🇺🇦', name: 'Ukraine' },
  { code: '+972', flag: '🇮🇱', name: 'Israel' },
  { code: '+20',  flag: '🇪🇬', name: 'Egypt' },
  { code: '+27',  flag: '🇿🇦', name: 'South Africa' },
  { code: '+234', flag: '🇳🇬', name: 'Nigeria' },
  { code: '+254', flag: '🇰🇪', name: 'Kenya' },
  { code: '+212', flag: '🇲🇦', name: 'Morocco' },
  { code: '+55',  flag: '🇧🇷', name: 'Brazil' },
  { code: '+52',  flag: '🇲🇽', name: 'Mexico' },
  { code: '+54',  flag: '🇦🇷', name: 'Argentina' },
  { code: '+56',  flag: '🇨🇱', name: 'Chile' },
  { code: '+57',  flag: '🇨🇴', name: 'Colombia' },
  { code: '+51',  flag: '🇵🇪', name: 'Peru' },
];

/**
 * Try to split a stored phone like "+880 17XXXXXXXX" into { dial, local }.
 * Falls back to default dial code when none matches.
 */
function splitDial(full: string, defaultDial = '+880'): { dial: string; local: string } {
  const trimmed = (full || '').trim();
  if (!trimmed) return { dial: defaultDial, local: '' };
  // Sort by length desc so "+880" matches before "+88" etc.
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const c of sorted) {
    if (trimmed.startsWith(c.code)) {
      return { dial: c.code, local: trimmed.slice(c.code.length).replace(/^[\s-]+/, '') };
    }
  }
  // Strip a leading "+" if present, return raw local
  return { dial: defaultDial, local: trimmed.replace(/^\+/, '') };
}

/** Combine dial code + local digits into a single stored value. */
function joinPhone(dial: string, local: string): string {
  const digits = (local || '').replace(/[^\d]/g, '');
  return digits ? `${dial} ${digits}` : '';
}

interface UserAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'signin' | 'signup';
}

export const UserAuthModal = ({ isOpen, onClose, defaultTab = 'signin' }: UserAuthModalProps) => {
  const { loginUser, loginWithGoogle, registerUser, resetUserPassword, sendPasswordOtp, verifyPasswordOtp, sendRegistrationOtp, verifyRegistrationOtp, userProfile, logoutUser, isUserLoggedIn, updateUserProfile, adminSettings, orders, siteSettings, updateOrderStatus, smtpSettings, emailVerificationSettings, checkPhoneAvailability } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState<'signin' | 'signup' | 'profile' | 'forgot'>(isUserLoggedIn ? 'profile' : defaultTab);
  const [fpEmail, setFpEmail] = useState('');
  const [fpOtp, setFpOtp] = useState('');
  const [fpNewPass, setFpNewPass] = useState('');
  const [fpConfPass, setFpConfPass] = useState('');
  const [fpStep, setFpStep] = useState<'email' | 'otp' | 'reset'>('email');
  const [fpVerifiedEmail, setFpVerifiedEmail] = useState('');
  const [profileTab, setProfileTab] = useState<'details' | 'orders'>('details');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [popStatus, setPopStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [cancelConfirmOrderId, setCancelConfirmOrderId] = useState<string | null>(null);
  // OTP resend countdown
  const [resendCountdown, setResendCountdown] = useState(0);
  const [wrongOtpAttempts, setWrongOtpAttempts] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Registration OTP step: after filling form, user verifies email via OTP before account is created
  const [regStep, setRegStep] = useState<'form' | 'otp'>('form');
  const [regOtp, setRegOtp] = useState('');
  const [regPendingData, setRegPendingData] = useState<null | { name: string; email: string; phone: string; address: string; city: string; pass: string }>(null);
  const [regResendCountdown, setRegResendCountdown] = useState(0);
  const regCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sign-In OTP Verification (NEW)
  const [signInOtpRequired, setSignInOtpRequired] = useState(false);
  const [signInOtpEmail, setSignInOtpEmail] = useState('');
  const [signInOtpCode, setSignInOtpCode] = useState('');
  const [signInOtpResendCount, setSignInOtpResendCount] = useState(0);
  const [signInOtpError, setSignInOtpError] = useState('');
  const [signInOtpLoading, setSignInOtpLoading] = useState(false);

  // reCAPTCHA state (v2 checkbox) - separate widget per tab so switching never corrupts state
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null);
  const recaptchaSigninRef = useRef<HTMLDivElement>(null);
  const recaptchaSignupRef = useRef<HTMLDivElement>(null);
  const recaptchaSigninWidgetId = useRef<number | null>(null);
  const recaptchaSignupWidgetId = useRef<number | null>(null);
  const recaptchaEnabled = !!(adminSettings?.recaptchaEnabled && adminSettings?.recaptchaSiteKey);

  // Load reCAPTCHA script dynamically when needed
  useEffect(() => {
    if (!recaptchaEnabled) return;
    const siteKey = adminSettings?.recaptchaSiteKey || '';
    if (!siteKey) return;
    if (document.querySelector('script[data-recaptcha]')) return;
    const script = document.createElement('script');
    script.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.setAttribute('data-recaptcha', '1');
    document.head.appendChild(script);
  }, [recaptchaEnabled, adminSettings?.recaptchaSiteKey]);

  // Render the correct widget whenever the active tab changes
  useEffect(() => {
    if (!recaptchaEnabled || !adminSettings?.recaptchaSiteKey) return;
    if (tab !== 'signin' && tab !== 'signup') return;
    const ref = tab === 'signin' ? recaptchaSigninRef : recaptchaSignupRef;
    const widgetIdRef = tab === 'signin' ? recaptchaSigninWidgetId : recaptchaSignupWidgetId;
    const render = () => {
      const g = (window as any).grecaptcha;
      if (!g?.render || !ref.current) return;
      if (widgetIdRef.current !== null) {
        try { g.reset(widgetIdRef.current); setRecaptchaToken(null); } catch {}
        return;
      }
      try {
        widgetIdRef.current = g.render(ref.current, {
          sitekey: adminSettings.recaptchaSiteKey,
          callback: (token: string) => setRecaptchaToken(token),
          'expired-callback': () => setRecaptchaToken(null),
          'error-callback': () => setRecaptchaToken(null),
        });
      } catch {}
    };
    if ((window as any).grecaptcha?.render) { render(); return; }
    const timer = setTimeout(render, 600);
    return () => clearTimeout(timer);
  }, [tab, recaptchaEnabled, adminSettings?.recaptchaSiteKey]);

  // Clear token when tab changes so the new tab starts unanswered
  useEffect(() => { setRecaptchaToken(null); }, [tab]);

  // --- reCAPTCHA server-side verification helper ----------------------------
  const verifyRecaptchaToken = async (token: string): Promise<{ ok: boolean; message?: string }> => {
    try {
      // Secret key is read server-side from RECAPTCHA_SECRET_KEY env var — never sent from client
      const res = await fetch('/api/verify-recaptcha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({ success: false }));
      return { ok: !!data.success, message: data.message };
    } catch {
      // Network error — allow through rather than blocking the user
      return { ok: true };
    }
  };

  const resetRecaptchaWidget = (forTab: 'signin' | 'signup') => {
    const widgetIdRef = forTab === 'signin' ? recaptchaSigninWidgetId : recaptchaSignupWidgetId;
    const g = (window as any).grecaptcha;
    if (g && widgetIdRef.current !== null) {
      try { g.reset(widgetIdRef.current); } catch {}
    }
    setRecaptchaToken(null);
  };

  // Sign in state
  const [siEmail, setSiEmail] = useState('');
  const [siPass, setSiPass] = useState('');

  // Sign up state
  const [suName, setSuName] = useState('');
  const [suEmail, setSuEmail] = useState('');
  const [suDialCode, setSuDialCode] = useState('+880');
  const [suPhone, setSuPhone] = useState('');
  const [suAddress, setSuAddress] = useState('');
  const [suCity, setSuCity] = useState('');
  const [suPass, setSuPass] = useState('');
  const [suPassConf, setSuPassConf] = useState('');

  // Profile edit state
  const [editName, setEditName] = useState(userProfile?.name || '');
  const [editDialCode, setEditDialCode] = useState(() => splitDial(userProfile?.phone || '').dial);
  const [editPhone, setEditPhone] = useState(() => splitDial(userProfile?.phone || '').local);
  const [editAddress, setEditAddress] = useState(userProfile?.address || '');
  const [editCity, setEditCity] = useState(userProfile?.city || '');

  React.useEffect(() => {
    if (isUserLoggedIn) {
      setTab('profile');
      setEditName(userProfile?.name || '');
      const parsed = splitDial(userProfile?.phone || '');
      setEditDialCode(parsed.dial);
      setEditPhone(parsed.local);
      setEditAddress(userProfile?.address || '');
      setEditCity(userProfile?.city || '');
    } else {
      setTab(defaultTab);
    }
  }, [isUserLoggedIn, defaultTab, userProfile]);

  const showPop = (type: 'success' | 'error', msg: string) => {
    setPopStatus({ type, msg });
    setTimeout(() => setPopStatus(null), 3000);
  };

  const startResendCountdown = () => {
    setResendCountdown(60);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setResendCountdown(prev => {
        if (prev <= 1) { clearInterval(countdownRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (recaptchaEnabled && !recaptchaToken) {
      showPop('error', 'Please complete the reCAPTCHA verification.');
      return;
    }
    if (recaptchaEnabled && recaptchaToken) {
      const captchaCheck = await verifyRecaptchaToken(recaptchaToken);
      if (!captchaCheck.ok) {
        resetRecaptchaWidget('signin');
        showPop('error', captchaCheck.message || 'reCAPTCHA verification failed. Please try again.');
        return;
      }
    }
    setLoading(true);
    try {
      const requiresOtp = !!emailVerificationSettings?.otpSignInVerification;
      const result = await loginUser(siEmail, siPass, requiresOtp);
      
      // NEW: Check if OTP Sign-In verification is enabled
      if (result.success && requiresOtp) {
        if (!smtpSettings?.isEnabled || !smtpSettings?.host || !smtpSettings?.email || !smtpSettings?.password) {
          showPop('error', 'Sign-in OTP email is enabled, but SMTP is not configured in Admin → SMTP Settings.');
          return;
        }

        // Generate OTP code
        const otpCode = String(Math.floor(100000 + Math.random() * 900000));
        const expiryMinutes = smtpSettings?.otpExpiryMinutes || 10;
        const emailKey = siEmail.trim().toLowerCase();
        const storeName = siteSettings?.websiteName || 'Store';
        
        // Save OTP to sessionStorage with expiry
        sessionStorage.setItem(`signin_otp_${emailKey}`, JSON.stringify({
          code: otpCode,
          expiresAt: Date.now() + expiryMinutes * 60_000,
          email: emailKey,
        }));

        const otpHtml = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#f8fafc;border-radius:12px;">
          <h2 style="color:#0f172a;margin:0 0 12px;text-align:center;">Your sign-in code</h2>
          <p style="color:#475569;font-size:14px;text-align:center;">Use this code to finish signing in to <strong>${storeName}</strong>.</p>
          <div style="background:#fff;border:2px dashed #10b981;border-radius:10px;padding:18px;margin:18px 0;text-align:center;font-size:30px;letter-spacing:8px;font-weight:800;color:#065f46;">${otpCode}</div>
          <p style="color:#64748b;font-size:12px;text-align:center;">This code expires in ${expiryMinutes} minutes.</p>
        </div>`;

        // Send OTP email through the admin-saved SMTP settings
        const otpResponse = await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: emailKey,
            subject: `Your ${storeName} sign-in code`,
            html: otpHtml,
            smtpSettings: { ...smtpSettings, fromName: smtpSettings.fromName || storeName },
          }),
        });
        const otpData = await otpResponse.json().catch(() => ({}));
        if (!otpResponse.ok || otpData?.simulated) {
          sessionStorage.removeItem(`signin_otp_${emailKey}`);
          showPop('error', otpData?.error || 'Could not send sign-in OTP. Check SMTP settings.');
          return;
        }

        // Show OTP verification screen
        setSignInOtpRequired(true);
        setSignInOtpEmail(emailKey);
        setSignInOtpCode('');
        setSignInOtpError('');
        setLoading(false);
        showPop('success', 'OTP sent to your email. Please verify to sign in.');
        return;
      }

      // Original login flow
      if (result.success) {
        showPop('success', result.message);
        setTimeout(onClose, 1500);
      } else {
        showPop('error', result.message);
        if (recaptchaEnabled) resetRecaptchaWidget('signin');
      }
    } catch (err) {
      showPop('error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // NEW: OTP Sign-In Verification Handler
  const handleSignInOtpVerify = async () => {
    if (!signInOtpCode.trim() || signInOtpCode.length !== 6) {
      setSignInOtpError('Please enter a valid 6-digit code');
      return;
    }

    setSignInOtpLoading(true);
    setSignInOtpError('');

    try {
      const storedOtp = sessionStorage.getItem(`signin_otp_${signInOtpEmail}`);
      
      if (!storedOtp) {
        setSignInOtpError('OTP expired. Please sign in again.');
        setSignInOtpLoading(false);
        return;
      }

      const { code, expiresAt } = JSON.parse(storedOtp);

      if (Date.now() > expiresAt) {
        setSignInOtpError('OTP has expired. Please request a new one.');
        sessionStorage.removeItem(`signin_otp_${signInOtpEmail}`);
        setSignInOtpLoading(false);
        return;
      }

      if (signInOtpCode !== code) {
        setSignInOtpError('Invalid OTP code. Please try again.');
        setSignInOtpLoading(false);
        return;
      }

      // OTP is valid - now open the user session
      const loginResult = await loginUser(signInOtpEmail, siPass, false);
      if (!loginResult.success) {
        setSignInOtpError(loginResult.message || 'Could not complete sign in. Please try again.');
        setSignInOtpLoading(false);
        return;
      }

      sessionStorage.removeItem(`signin_otp_${signInOtpEmail}`);
      setSignInOtpRequired(false);
      setSignInOtpEmail('');
      setSignInOtpCode('');
      setSignInOtpResendCount(0);
      setSiEmail('');
      setSiPass('');
      setLoading(false);

      showPop('success', 'OTP verified! Signed in successfully.');
      setTimeout(onClose, 1500);
    } catch (err) {
      setSignInOtpError('Verification failed. Please try again.');
      setSignInOtpLoading(false);
    }
  };

  // NEW: OTP Resend Handler
  const handleSignInOtpResend = async () => {
    setSignInOtpResendCount(prev => prev + 1);
    setSignInOtpError('');
    
    try {
      if (!smtpSettings?.isEnabled || !smtpSettings?.host || !smtpSettings?.email || !smtpSettings?.password) {
        setSignInOtpError('SMTP is not configured. Contact the store admin.');
        return;
      }
      const otpCode = String(Math.floor(100000 + Math.random() * 900000));
      const expiryMinutes = smtpSettings?.otpExpiryMinutes || 10;
      const storeName = siteSettings?.websiteName || 'Store';
      
      sessionStorage.setItem(`signin_otp_${signInOtpEmail}`, JSON.stringify({
        code: otpCode,
        expiresAt: Date.now() + expiryMinutes * 60_000,
        email: signInOtpEmail,
      }));

      const otpHtml = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#f8fafc;border-radius:12px;">
        <h2 style="color:#0f172a;margin:0 0 12px;text-align:center;">Your sign-in code</h2>
        <p style="color:#475569;font-size:14px;text-align:center;">Use this code to finish signing in to <strong>${storeName}</strong>.</p>
        <div style="background:#fff;border:2px dashed #10b981;border-radius:10px;padding:18px;margin:18px 0;text-align:center;font-size:30px;letter-spacing:8px;font-weight:800;color:#065f46;">${otpCode}</div>
        <p style="color:#64748b;font-size:12px;text-align:center;">This code expires in ${expiryMinutes} minutes.</p>
      </div>`;

      const resendResponse = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: signInOtpEmail,
          subject: `Your ${storeName} sign-in code`,
          html: otpHtml,
          smtpSettings: { ...smtpSettings, fromName: smtpSettings.fromName || storeName },
        }),
      });
      const resendData = await resendResponse.json().catch(() => ({}));
      if (!resendResponse.ok || resendData?.simulated) {
        setSignInOtpError(resendData?.error || 'Could not resend OTP. Check SMTP settings.');
        return;
      }

      showPop('success', 'OTP resent to your email.');
    } catch (err) {
      setSignInOtpError('Failed to resend OTP. Please try again.');
    }
  };

  const handleForgotVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = fpEmail.trim().toLowerCase();
    if (!email) { showPop('error', 'Please enter your email address.'); return; }
    setLoading(true);
    const result = await sendPasswordOtp(email);
    setLoading(false);
    if (result.success) {
      setFpVerifiedEmail(email);
      setFpStep('otp');
      setWrongOtpAttempts(0);
      startResendCountdown();
      showPop('success', result.message);
    } else {
      showPop('error', result.message);
    }
  };

  const handleForgotVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    const result = verifyPasswordOtp(fpVerifiedEmail, fpOtp);
    if (result.success) {
      setFpStep('reset');
      showPop('success', 'OTP verified! Set your new password.');
    } else {
      setWrongOtpAttempts(prev => prev + 1);
      showPop('error', result.message);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fpNewPass !== fpConfPass) { showPop('error', 'Passwords do not match.'); return; }
    if (fpNewPass.length < 6) { showPop('error', 'Password must be at least 6 characters.'); return; }
    
    setLoading(true);
    try {
      // ✅ FIREBASE FIX: Must await resetUserPassword - it saves to Firestore!
      const result = await resetUserPassword(fpVerifiedEmail, fpNewPass);
      if (result.success) {
        showPop('success', result.message);
        setTimeout(() => { 
          setTab('signin'); 
          setFpStep('email'); 
          setFpEmail(''); 
          setFpOtp(''); 
          setFpNewPass(''); 
          setFpConfPass(''); 
          setFpVerifiedEmail('');
          setWrongOtpAttempts(0);
        }, 2000);
      } else {
        showPop('error', result.message);
      }
    } catch (err: any) {
      console.error('[PASSWORD RESET] Firebase error:', err);
      showPop('error', err?.message || 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    const result = await loginWithGoogle();
    setLoading(false);
    if (result.success) {
      showPop('success', result.message);
      setTimeout(onClose, 1200);
    } else {
      showPop('error', result.message);
    }
  };

  // Step 1: Validate form, send OTP
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (suPass !== suPassConf) { showPop('error', 'Passwords do not match.'); return; }
    if (suPass.length < 6) { showPop('error', 'Password must be at least 6 characters.'); return; }
    const localDigits = suPhone.replace(/[^\d]/g, '');
    if (localDigits.length < 6 || localDigits.length > 14) {
      showPop('error', 'Please enter a valid mobile number (6–14 digits).');
      return;
    }
    if (recaptchaEnabled && !recaptchaToken) {
      showPop('error', 'Please complete the reCAPTCHA verification.');
      return;
    }
    if (recaptchaEnabled && recaptchaToken) {
      const captchaCheck = await verifyRecaptchaToken(recaptchaToken);
      if (!captchaCheck.ok) {
        resetRecaptchaWidget('signup');
        showPop('error', captchaCheck.message || 'reCAPTCHA verification failed. Please try again.');
        return;
      }
    }
    setLoading(true);
    try {
      const fullPhone = joinPhone(suDialCode, suPhone);
      const phoneCheck = await checkPhoneAvailability(fullPhone);
      if (!phoneCheck.available) {
        showPop('error', phoneCheck.message);
        return;
      }
      const result = await sendRegistrationOtp(suEmail, suName);
      if (result.success) {
        if (recaptchaEnabled) resetRecaptchaWidget('signup');
        setRegPendingData({ name: suName, email: suEmail, phone: fullPhone, address: suAddress, city: suCity, pass: suPass });
        setRegStep('otp');
        setRegOtp('');
        // Start resend countdown
        setRegResendCountdown(60);
        if (regCountdownRef.current) clearInterval(regCountdownRef.current);
        regCountdownRef.current = setInterval(() => {
          setRegResendCountdown(p => { if (p <= 1) { clearInterval(regCountdownRef.current!); return 0; } return p - 1; });
        }, 1000);
        showPop('success', result.message);
      } else {
        showPop('error', result.message);
      }
    } catch {
      showPop('error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify OTP then create account
  const handleRegOtpVerify = async () => {
    if (!regPendingData || !regOtp.trim()) { showPop('error', 'Enter the 6-digit code.'); return; }
    const verifyResult = verifyRegistrationOtp(regPendingData.email, regOtp.trim());
    if (!verifyResult.success) { showPop('error', verifyResult.message); return; }
    setLoading(true);
    try {
      const result = await registerUser(
        { name: regPendingData.name, email: regPendingData.email, phone: regPendingData.phone, address: regPendingData.address, city: regPendingData.city },
        regPendingData.pass,
      );
      if (result.success) {
        showPop('success', '🎉 Account created! Welcome, ' + regPendingData.name + '!');
        setRegStep('form');
        setRegPendingData(null);
        setTimeout(onClose, 1500);
      } else {
        showPop('error', result.message);
      }
    } catch {
      showPop('error', 'Account creation failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegOtpResend = async () => {
    if (!regPendingData || regResendCountdown > 0) return;
    setLoading(true);
    const result = await sendRegistrationOtp(regPendingData.email, regPendingData.name);
    setLoading(false);
    if (result.success) {
      showPop('success', 'New code sent!');
      setRegResendCountdown(60);
      if (regCountdownRef.current) clearInterval(regCountdownRef.current);
      regCountdownRef.current = setInterval(() => {
        setRegResendCountdown(p => { if (p <= 1) { clearInterval(regCountdownRef.current!); return 0; } return p - 1; });
      }, 1000);
    } else {
      showPop('error', result.message);
    }
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    const localDigits = editPhone.replace(/[^\d]/g, '');
    if (localDigits.length < 6 || localDigits.length > 14) {
      showPop('error', 'Please enter a valid mobile number (6–14 digits).');
      return;
    }
    setLoading(true);
    try {
      // ✅ FIREBASE FIX: Must await updateUserProfile - it saves to Firestore!
      await updateUserProfile({ 
        ...userProfile, 
        name: editName, 
        phone: joinPhone(editDialCode, editPhone), 
        address: editAddress, 
        city: editCity 
      });
      showPop('success', 'Profile updated successfully!');
    } catch (err: any) {
      console.error('[PROFILE UPDATE] Firebase error:', err);
      showPop('error', err?.message || 'Failed to update profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logoutUser();
    onClose();
    toast.success('Signed out successfully.');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in">
        {/* Header gradient */}
        <div className="bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 px-6 pt-8 pb-12 text-white text-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
          <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors">
            <X className="w-4 h-4" />
          </button>
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg">
            {isUserLoggedIn ? <User className="w-8 h-8" /> : tab === 'signin' ? <LogIn className="w-8 h-8" /> : <UserPlus className="w-8 h-8" />}
          </div>
          <h2 className="text-xl font-black tracking-tight">
            {isUserLoggedIn ? 'My Account' : tab === 'signin' ? 'Welcome Back!' : 'Create Account'}
          </h2>
          <p className="text-emerald-100 text-xs mt-1">
            {isUserLoggedIn ? userProfile?.email : tab === 'signin' ? 'Sign in to auto-fill your orders' : 'Your info auto-fills at checkout'}
          </p>
        </div>

        {/* Tab switcher (non-logged in) */}
        {!isUserLoggedIn && (
          <div className="flex mx-6 -mt-5 rounded-2xl overflow-hidden shadow-lg border border-white z-10 relative bg-white">
            <button
              onClick={() => setTab('signin')}
              className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide transition-all flex items-center justify-center gap-1.5 ${tab === 'signin' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              <LogIn className="w-3.5 h-3.5" /> Sign In
            </button>
            <button
              onClick={() => setTab('signup')}
              className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide transition-all flex items-center justify-center gap-1.5 ${tab === 'signup' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              <UserPlus className="w-3.5 h-3.5" /> Sign Up
            </button>
          </div>
        )}

        {/* Status popup */}
        {popStatus && (
          <div className={`mx-6 mt-4 rounded-xl px-4 py-3 flex items-center gap-2.5 text-sm font-semibold animate-fade-in ${popStatus.type === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-rose-50 border border-rose-200 text-rose-800'}`}>
            {popStatus.type === 'success' ? <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 text-rose-500 flex-shrink-0" />}
            {popStatus.msg}
          </div>
        )}

        <div className="px-6 py-5 max-h-[65vh] overflow-y-auto">

          {/* SIGN IN FORM */}
          {!isUserLoggedIn && tab === 'signin' && (
            <>
              {signInOtpRequired ? (
                // OTP Verification Screen (NEW)
                <div className="space-y-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
                    <p className="font-semibold">Enter Your OTP Code</p>
                    <p className="text-xs mt-1">
                      We sent a 6-digit code to <span className="font-mono font-bold">{signInOtpEmail}</span>
                    </p>
                  </div>

                  <div>
                    <label htmlFor="signin-otp" className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">
                      6-Digit OTP Code
                    </label>
                    <input
                      id="signin-otp"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="000000"
                      value={signInOtpCode}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        setSignInOtpCode(val);
                        setSignInOtpError('');
                      }}
                      autoComplete="off"
                      className="w-full bg-slate-50 border border-slate-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 rounded-lg px-3 py-2 text-lg font-bold text-center tracking-widest outline-none transition-all"
                    />
                    {signInOtpError && (
                      <p className="text-xs text-red-600 font-semibold mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" /> {signInOtpError}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={handleSignInOtpVerify}
                    disabled={signInOtpLoading || signInOtpCode.length !== 6}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold uppercase text-xs rounded-lg transition-colors disabled:cursor-not-allowed"
                  >
                    {signInOtpLoading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" /> Verifying...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" /> Verify OTP
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleSignInOtpResend}
                    disabled={signInOtpResendCount > 0 && signInOtpResendCount < 3}
                    className="w-full text-xs text-center text-blue-600 hover:text-blue-700 font-semibold uppercase py-2 disabled:text-slate-400 transition-colors"
                  >
                    {signInOtpResendCount > 0 && signInOtpResendCount < 3
                      ? `Resend in ${30 - (signInOtpResendCount * 10)}s`
                      : 'Resend OTP'}
                  </button>

                  <button
                    onClick={() => {
                      setSignInOtpRequired(false);
                      setSiEmail('');
                      setSiPass('');
                      sessionStorage.removeItem(`signin_otp_${signInOtpEmail}`);
                    }}
                    className="w-full text-xs text-center text-slate-500 hover:text-slate-700 font-semibold py-2 transition-colors"
                  >
                    Back to Sign In
                  </button>
                </div>
              ) : (
                // Normal Sign-In Form
                <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label htmlFor="auth-signin-email" className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input id="auth-signin-email" type="email" required value={siEmail} onChange={e => setSiEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all" />
                </div>
              </div>
              <div>
                <label htmlFor="auth-signin-password" className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input id="auth-signin-password" type={showPassword ? 'text' : 'password'} required value={siPass} onChange={e => setSiPass(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="text-right mt-1">
                  <button type="button" onClick={() => { setTab('forgot'); setFpStep('email'); setFpEmail(siEmail); }} className="text-[11px] text-emerald-600 hover:text-emerald-700 font-semibold hover:underline">
                    Forgot password?
                  </button>
                </div>
              </div>
              {/* reCAPTCHA widget (shown only when enabled in admin) */}
              {recaptchaEnabled && (
                <div className="flex justify-center">
                  <div ref={recaptchaSigninRef} />
                </div>
              )}
              <button type="submit" disabled={loading || (recaptchaEnabled && !recaptchaToken)}
                className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold rounded-xl text-sm shadow-sm transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                {loading ? <span className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" /> : <LogIn className="w-4 h-4" />}
                {loading ? 'Signing in...' : 'Sign In'}
              </button>

              {adminSettings?.googleSignInEnabled && (
                <>
                  {/* Divider */}
                  <div className="flex items-center gap-3 my-1">
                    <div className="flex-1 h-px bg-slate-200" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">or</span>
                    <div className="flex-1 h-px bg-slate-200" />
                  </div>
                  {/* Google Sign In */}
                  <button type="button" onClick={handleGoogleSignIn} disabled={loading}
                    className="w-full py-2.5 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-700 font-semibold rounded-xl text-sm shadow-xs transition-all disabled:opacity-60 flex items-center justify-center gap-3 group">
                    <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" xmlns="http://www.w3.org/2000/svg">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    <span>Continue with Google</span>
                  </button>
                </>
              )}

              <p className="text-center text-xs text-slate-400">Don't have an account? <button type="button" onClick={() => setTab('signup')} className="text-emerald-600 font-bold hover:underline">Sign Up</button></p>
                </form>
              )}
            </>
          )}

          {/* FORGOT PASSWORD PANEL */}
          {!isUserLoggedIn && tab === 'forgot' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <button type="button" onClick={() => { setTab('signin'); setFpStep('email'); }} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                  <ChevronRight className="w-4 h-4 rotate-180" />
                </button>
                <span className="text-xs font-bold uppercase text-slate-500">Reset Password</span>
              </div>

              {/* Step 1: Email */}
              {fpStep === 'email' && (
                <form onSubmit={handleForgotVerifyEmail} className="space-y-4">
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-[11px] text-blue-700">
                    <p className="font-bold mb-0.5">Enter your account email</p>
                    <p>We'll send a 6-digit OTP to verify it's you.</p>
                  </div>
                  <div>
                    <label htmlFor="auth-forgot-email" className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                      <input id="auth-forgot-email" type="email" required value={fpEmail} onChange={e => setFpEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all" />
                    </div>
                  </div>
                  <button type="submit" disabled={loading}
                    className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold rounded-xl text-sm shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60">
                    {loading ? <span className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" /> : <Mail className="w-4 h-4" />}
                    {loading ? 'Sending OTP...' : 'Send OTP to Email'}
                  </button>
                  <p className="text-center text-xs text-slate-400">Remembered it? <button type="button" onClick={() => setTab('signin')} className="text-emerald-600 font-bold hover:underline">Sign In</button></p>
                </form>
              )}

              {/* Step 2: OTP verification */}
              {fpStep === 'otp' && (
                <form onSubmit={handleForgotVerifyOtp} className="space-y-4">
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-[11px] text-amber-700">
                    <p className="font-bold mb-0.5">Check your inbox</p>
                    <p>We sent a 6-digit OTP to <span className="font-mono font-bold">{fpVerifiedEmail}</span>. Enter it below.</p>
                  </div>
                  <div>
                    <label htmlFor="auth-forgot-otp" className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">6-Digit OTP</label>
                    <input
                      id="auth-forgot-otp"
                      type="text"
                      required
                      maxLength={6}
                      value={fpOtp}
                      onChange={e => setFpOtp(e.target.value.replace(/\D/g, ''))}
                      placeholder="000000"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xl font-mono font-bold text-center tracking-[0.5em] outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all"
                    />
                    {wrongOtpAttempts > 0 && (
                      <p className="text-[10px] text-rose-600 font-semibold mt-1 text-center">
                        {wrongOtpAttempts} incorrect attempt{wrongOtpAttempts !== 1 ? 's' : ''} · {Math.max(0, 5 - wrongOtpAttempts)} remaining
                      </p>
                    )}
                  </div>
                  <button type="submit"
                    className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold rounded-xl text-sm shadow-sm transition-all flex items-center justify-center gap-2">
                    <CheckCircle className="w-4 h-4" /> Verify OTP
                  </button>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <button type="button" onClick={() => setFpStep('email')} className="hover:text-slate-600">← Use different email</button>
                    <button type="button" disabled={loading || resendCountdown > 0} onClick={async () => {
                      setLoading(true);
                      const r = await sendPasswordOtp(fpVerifiedEmail);
                      setLoading(false);
                      if (r.success) { startResendCountdown(); setWrongOtpAttempts(0); }
                      showPop(r.success ? 'success' : 'error', r.message);
                    }} className="text-emerald-600 hover:text-emerald-700 font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
                      {loading ? 'Resending...' : resendCountdown > 0 ? `Resend in ${resendCountdown}s` : 'Resend OTP'}
                    </button>
                  </div>
                </form>
              )}

              {/* Step 3: New password */}
              {fpStep === 'reset' && (
                <form onSubmit={handleResetPassword} className="space-y-4">
                  <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-[11px] text-emerald-700">
                    <p className="font-bold mb-0.5">Identity verified ✓</p>
                    <p className="font-mono">{fpVerifiedEmail}</p>
                  </div>
                  <div>
                    <label htmlFor="auth-forgot-newpass" className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">New Password</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                      <input id="auth-forgot-newpass" type={showPassword ? 'text' : 'password'} required value={fpNewPass} onChange={e => setFpNewPass(e.target.value)}
                        placeholder="Min. 6 characters"
                        className="w-full pl-9 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all" />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="auth-forgot-confpass" className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">Confirm New Password</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                      <input id="auth-forgot-confpass" type={showPassword ? 'text' : 'password'} required value={fpConfPass} onChange={e => setFpConfPass(e.target.value)}
                        placeholder="Repeat new password"
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all" />
                    </div>
                  </div>
                  <button type="submit"
                    className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold rounded-xl text-sm shadow-sm transition-all flex items-center justify-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Reset Password
                  </button>
                </form>
              )}
            </div>
          )}

          {/* SIGN UP FORM */}
          {!isUserLoggedIn && tab === 'signup' && (
          <>
            {/* OTP Verification Step */}
            {regStep === 'otp' && regPendingData && (
              <div className="space-y-4">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center space-y-1">
                  <Mail className="w-6 h-6 text-emerald-600 mx-auto" />
                  <p className="text-sm font-bold text-slate-700">Check your inbox!</p>
                  <p className="text-xs text-slate-500">We sent a 6-digit code to <span className="font-mono font-bold text-emerald-700">{regPendingData.email}</span></p>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">6-Digit Verification Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={regOtp}
                    onChange={e => setRegOtp(e.target.value.replace(/\D/g, ''))}
                    placeholder="Enter code"
                    className="w-full text-center text-2xl font-bold tracking-widest py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all"
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  onClick={handleRegOtpVerify}
                  disabled={loading || regOtp.length < 6}
                  className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold rounded-xl text-sm shadow-sm transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {loading ? <span className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  {loading ? 'Verifying...' : 'Verify & Create Account'}
                </button>
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => { setRegStep('form'); setRegOtp(''); }} className="text-xs text-slate-500 hover:text-slate-700 underline">
                    ← Back to form
                  </button>
                  <button
                    type="button"
                    onClick={handleRegOtpResend}
                    disabled={loading || regResendCountdown > 0}
                    className="text-xs text-emerald-600 font-semibold hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {regResendCountdown > 0 ? `Resend in ${regResendCountdown}s` : 'Resend code'}
                  </button>
                </div>
              </div>
            )}

            {/* Sign-Up Form */}
            {regStep === 'form' && (
            <form onSubmit={handleSignUp} className="space-y-3">
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label htmlFor="auth-signup-name" className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input id="auth-signup-name" type="text" required value={suName} onChange={e => setSuName(e.target.value)} placeholder="Your full name"
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all" />
                  </div>
                </div>
                <div>
                  <label htmlFor="auth-signup-email" className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input id="auth-signup-email" type="email" required value={suEmail} onChange={e => setSuEmail(e.target.value)} placeholder="you@example.com"
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all" />
                  </div>
                </div>
                <div>
                  <label htmlFor="auth-signup-phone" className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Phone Number</label>
                  <div className="flex gap-2">
                    <select
                      aria-label="Country code"
                      value={suDialCode}
                      onChange={e => setSuDialCode(e.target.value)}
                      className="w-[110px] px-2 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all cursor-pointer"
                    >
                      {COUNTRY_CODES.map(c => (
                        <option key={c.code + c.name} value={c.code}>{c.flag} {c.code}</option>
                      ))}
                    </select>
                    <div className="relative flex-1">
                      <Phone className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                      <input
                        id="auth-signup-phone"
                        type="tel"
                        required
                        inputMode="numeric"
                        value={suPhone}
                        onChange={e => setSuPhone(e.target.value.replace(/[^\d\s-]/g, ''))}
                        placeholder="17XXXXXXXX"
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all"
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <label htmlFor="auth-signup-address" className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Delivery Address</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input id="auth-signup-address" type="text" required value={suAddress} onChange={e => setSuAddress(e.target.value)} placeholder="Street address"
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all" />
                  </div>
                </div>
                <div>
                  <label htmlFor="auth-signup-city" className="block text-[10px] font-bold uppercase text-slate-500 mb-1">City</label>
                  <input id="auth-signup-city" type="text" required value={suCity} onChange={e => setSuCity(e.target.value)} placeholder="Dhaka"
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all" />
                </div>
                <div>
                  <label htmlFor="auth-signup-password" className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input id="auth-signup-password" type={showPassword ? 'text' : 'password'} required value={suPass} onChange={e => setSuPass(e.target.value)} placeholder="Min 6 characters"
                      className="w-full pl-9 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-2.5 text-slate-400">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {/* Password strength indicator */}
                  {suPass.length > 0 && (() => {
                    const checks = [suPass.length >= 8, /[A-Z]/.test(suPass), /[0-9]/.test(suPass), /[^A-Za-z0-9]/.test(suPass)];
                    const score = checks.filter(Boolean).length;
                    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
                    const colors = ['', 'bg-red-500', 'bg-orange-400', 'bg-yellow-400', 'bg-emerald-500'];
                    const textColors = ['', 'text-red-600', 'text-orange-500', 'text-yellow-600', 'text-emerald-600'];
                    return (
                      <div className="mt-1.5 space-y-1">
                        <div className="flex gap-1">
                          {[1,2,3,4].map(i => (
                            <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= score ? colors[score] : 'bg-slate-200'}`} />
                          ))}
                        </div>
                        <p className={`text-[10px] font-bold ${textColors[score]}`}>{labels[score]}</p>
                      </div>
                    );
                  })()}
                </div>
                <div>
                  <label htmlFor="auth-signup-confpass" className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Confirm Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input id="auth-signup-confpass" type={showPassword ? 'text' : 'password'} required value={suPassConf} onChange={e => setSuPassConf(e.target.value)} placeholder="Repeat password"
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all" />
                  </div>
                </div>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-[10px] text-emerald-700 font-medium">
                💡 Your details auto-fill at checkout — no re-typing needed!
              </div>
              {/* reCAPTCHA widget for signup */}
              {recaptchaEnabled && (
                <div className="flex justify-center">
                  <div ref={recaptchaSignupRef} />
                </div>
              )}
              <button type="submit" disabled={loading || (recaptchaEnabled && !recaptchaToken)}
                className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold rounded-xl text-sm shadow-sm transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                {loading ? <span className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" /> : <UserPlus className="w-4 h-4" />}
                {loading ? 'Creating account...' : 'Create Account'}
              </button>

              {adminSettings?.googleSignInEnabled && (
                <>
                  {/* Divider */}
                  <div className="flex items-center gap-3 my-1">
                    <div className="flex-1 h-px bg-slate-200" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">or</span>
                    <div className="flex-1 h-px bg-slate-200" />
                  </div>
                  {/* Google Sign Up */}
                  <button type="button" onClick={handleGoogleSignIn} disabled={loading}
                    className="w-full py-2.5 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-700 font-semibold rounded-xl text-sm shadow-xs transition-all disabled:opacity-60 flex items-center justify-center gap-3">
                    <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" xmlns="http://www.w3.org/2000/svg">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    <span>Sign up with Google</span>
                  </button>
                </>
              )}

              <p className="text-center text-xs text-slate-400">Already have an account? <button type="button" onClick={() => setTab('signin')} className="text-emerald-600 font-bold hover:underline">Sign In</button></p>
            </form>
            )}
          </>
          )}

          {/* PROFILE VIEW */}
          {isUserLoggedIn && userProfile && (() => {
            const currencySymbol = siteSettings?.currencySymbol || '$';
            const currencyPosition = (siteSettings?.currencyPosition || 'before') as 'before' | 'after';
            const fmt = (n: number) => currencyPosition === 'before' ? `${currencySymbol}${n.toFixed(2)}` : `${n.toFixed(2)}${currencySymbol}`;
            const userOrders: Order[] = orders
              .filter(o => userProfile.orderIds?.includes(o.id) || o.email?.toLowerCase() === userProfile.email?.toLowerCase())
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

            const statusColor: Record<string, string> = {
              Pending: 'bg-amber-100 text-amber-700', Processing: 'bg-blue-100 text-blue-700',
              Confirmed: 'bg-indigo-100 text-indigo-700', Shipped: 'bg-violet-100 text-violet-700',
              Delivered: 'bg-emerald-100 text-emerald-700', Cancelled: 'bg-rose-100 text-rose-700',
              Refunded: 'bg-slate-100 text-slate-600',
            };

            return (
            <div className="space-y-4">
              {/* Avatar */}
              <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
                <div className="w-12 h-12 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center text-white font-black text-lg shadow">
                  {userProfile.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-bold text-slate-800">{userProfile.name}</div>
                  <div className="text-xs text-slate-500">{userProfile.email}</div>
                </div>
              </div>

              {/* Sub-tabs */}
              <div className="flex rounded-xl overflow-hidden border border-slate-200">
                <button onClick={() => setProfileTab('details')}
                  className={`flex-1 py-2 text-xs font-bold uppercase flex items-center justify-center gap-1.5 transition-all cursor-pointer ${profileTab === 'details' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                  <User className="w-3.5 h-3.5" /> Profile
                </button>
                <button onClick={() => setProfileTab('orders')}
                  className={`flex-1 py-2 text-xs font-bold uppercase flex items-center justify-center gap-1.5 transition-all cursor-pointer ${profileTab === 'orders' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                  <ShoppingBag className="w-3.5 h-3.5" /> Orders {userOrders.length > 0 && <span className="bg-white/30 text-current rounded-full px-1.5 py-0.5 text-[9px] font-black">{userOrders.length}</span>}
                </button>
              </div>

              {/* Profile details tab */}
              {profileTab === 'details' && (
                <form onSubmit={handleProfileSave} className="space-y-3">
                  <h4 className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Edit Your Details</h4>
                  <div>
                    <label htmlFor="auth-profile-name" className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Name</label>
                    <input id="auth-profile-name" type="text" required value={editName} onChange={e => setEditName(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all" />
                  </div>
                  <div>
                    <label htmlFor="auth-profile-phone" className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Phone</label>
                    <div className="flex gap-2">
                      <select
                        aria-label="Country code"
                        value={editDialCode}
                        onChange={e => setEditDialCode(e.target.value)}
                        className="w-[110px] px-2 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all cursor-pointer"
                      >
                        {COUNTRY_CODES.map(c => (
                          <option key={c.code + c.name} value={c.code}>{c.flag} {c.code}</option>
                        ))}
                      </select>
                      <input
                        id="auth-profile-phone"
                        type="tel"
                        required
                        inputMode="numeric"
                        value={editPhone}
                        onChange={e => setEditPhone(e.target.value.replace(/[^\d\s-]/g, ''))}
                        placeholder="17XXXXXXXX"
                        className="flex-1 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="auth-profile-address" className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Delivery Address</label>
                    <input id="auth-profile-address" type="text" required value={editAddress} onChange={e => setEditAddress(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all" />
                  </div>
                  <div>
                    <label htmlFor="auth-profile-city" className="block text-[10px] font-bold uppercase text-slate-500 mb-1">City</label>
                    <input id="auth-profile-city" type="text" required value={editCity} onChange={e => setEditCity(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all" />
                  </div>
                  <button type="submit" className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition-all cursor-pointer">
                    Save Changes
                  </button>
                </form>
              )}

              {/* Orders history tab */}
              {profileTab === 'orders' && (
                <div className="space-y-3">
                  {userOrders.length === 0 ? (
                    <div className="text-center py-8 space-y-2">
                      <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto">
                        <Package size={20} className="text-slate-400" />
                      </div>
                      <p className="font-bold text-slate-600 text-sm">No orders yet</p>
                      <p className="text-xs text-slate-400">Your order history will appear here after you place an order.</p>
                    </div>
                  ) : (
                    userOrders.map(order => (
                      <div key={order.id} className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                        {/* Cancel confirmation dialog */}
                        {cancelConfirmOrderId === order.id && (
                          <div className="bg-rose-50 border-b border-rose-200 px-3 py-2.5">
                            <p className="text-xs font-bold text-rose-800 mb-2">Cancel order <span className="font-mono">{order.orderNumber}</span>?</p>
                            <div className="flex gap-2">
                              <button
                                onClick={async () => {
                                  await updateOrderStatus(order.id, 'Cancelled');
                                  setCancelConfirmOrderId(null);
                                  showPop('success', `Order ${order.orderNumber} has been cancelled.`);
                                }}
                                className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
                              >
                                Yes, Cancel
                              </button>
                              <button
                                onClick={() => setCancelConfirmOrderId(null)}
                                className="flex-1 py-1.5 bg-white border border-slate-200 text-slate-600 font-bold text-xs rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                              >
                                Keep Order
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="flex items-center justify-between px-3 py-2.5 bg-white border-b border-slate-100">
                          <div>
                            <p className="font-extrabold text-slate-800 text-xs">{order.orderNumber}</p>
                            <p className="text-[9px] text-slate-400">{new Date(order.createdAt).toLocaleDateString()}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${statusColor[order.orderStatus] || 'bg-slate-100 text-slate-600'}`}>
                              {order.orderStatus}
                            </span>
                            {order.orderStatus === 'Pending' && (
                              <button
                                onClick={() => setCancelConfirmOrderId(order.id)}
                                className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-600 hover:bg-rose-200 transition-colors cursor-pointer"
                              >
                                Cancel
                              </button>
                            )}
                            <button
                              onClick={() => { onClose(); window.location.href = `/tracker?order=${order.orderNumber}`; }}
                              className="text-emerald-600 hover:text-emerald-700 cursor-pointer"
                            >
                              <ChevronRight size={14} />
                            </button>
                          </div>
                        </div>
                        <div className="px-3 py-2 flex items-center justify-between text-xs text-slate-600">
                          <span>{order.items.length} item{order.items.length !== 1 ? 's' : ''} · {order.paymentMethod}</span>
                          <span className="font-extrabold text-slate-900">{fmt(order.total)}</span>
                        </div>
                      </div>
                    ))
                  )}
                  {siteSettings?.orderTrackerEnabled !== false && (
                    <button
                      onClick={() => { onClose(); window.location.href = '/tracker'; }}
                      className="w-full py-2 border border-emerald-200 bg-emerald-50 text-emerald-700 font-bold text-xs rounded-xl hover:bg-emerald-100 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Package size={13} /> Open Order Tracker
                    </button>
                  )}
                </div>
              )}

              <button onClick={handleLogout}
                className="w-full py-2.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 font-bold rounded-xl text-sm transition-all cursor-pointer">
                Sign Out
              </button>
            </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};
