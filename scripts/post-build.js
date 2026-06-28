#!/usr/bin/env node
/**
 * Post-build script: Handles Firebase config for all platforms
 *
 * Runs AFTER Vite build completes.
 *
 * Usage:
 *   node scripts/post-build.js          (auto-detect platform)
 *   node scripts/post-build.js render   (Render)
 *   node scripts/post-build.js vercel   (Vercel)
 *   node scripts/post-build.js cpanel   (cPanel)
 *   node scripts/post-build.js vps      (VPS)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Platform detection
const platform = process.argv[2] || detectPlatform();
const distDir = path.join(__dirname, '..', 'dist');
const configPath = path.join(distDir, 'firebase-config.json');

console.log(`\n🔨 Post-build: Platform detected as "${platform}"\n`);

/**
 * STEP 1: Try to load Firebase config from various sources
 */

let firebaseConfig = null;

// Priority 1: Environment variables (VITE_FIREBASE_*)
if (process.env.VITE_FIREBASE_API_KEY && process.env.VITE_FIREBASE_PROJECT_ID) {
  firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
    databaseId: process.env.VITE_FIREBASE_DATABASE_ID || '(default)',
  };
  console.log('✓ Loaded from VITE_FIREBASE_* environment variables');
}

// Priority 2: .env file (for local development)
if (!firebaseConfig) {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      firebaseConfig = parseEnvFile(envContent);
      if (firebaseConfig && firebaseConfig.apiKey) {
        console.log('✓ Loaded from .env file');
      } else {
        firebaseConfig = null;
      }
    }
  } catch (err) {
    console.warn('⚠  Could not read .env file:', err.message);
  }
}

// Do not read or copy firebase-config.json from the repo root. Public static
// config files are intentionally unsupported; use FIREBASE_* / VITE_FIREBASE_*
// environment variables and the server/API endpoint instead.

/**
 * STEP 2: Copy/create config in appropriate location for the platform
 */

// Make sure dist exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Platform-specific handling
switch (platform) {
  case 'render':
    handleRender(firebaseConfig, configPath);
    break;
  case 'vercel':
    handleVercel(firebaseConfig, configPath);
    break;
  case 'cpanel':
    handleCPanel(firebaseConfig, configPath);
    break;
  case 'vps':
    handleVPS(firebaseConfig, configPath);
    break;
  default:
    handleLocal(firebaseConfig, configPath);
}

/**
 * STEP 3: Summary
 */

console.log('\n' + '='.repeat(70));
if (firebaseConfig && firebaseConfig.apiKey) {
  console.log('✅ Firebase config ready for deployment');
  console.log(`   Platform: ${platform}`);
  console.log(`   Project ID: ${firebaseConfig.projectId}`);
} else {
  console.log('⚠️  Firebase config is EMPTY');
  console.log('   App will use InstallWizard or mock mode.');
  console.log('\n   To fix: Set FIREBASE_* / VITE_FIREBASE_* environment variables');
}
console.log('='.repeat(70) + '\n');

// ════════════════════════════════════════════════════════════════════════════════
// PLATFORM HANDLERS
// ════════════════════════════════════════════════════════════════════════════════

function handleRender(config, configPath) {
  console.log('\n📦 Render Configuration:');

  if (config && config.apiKey) {
    console.log('   ✓ Firebase env vars detected');
    console.log('   ✓ Server will expose config from environment variables only');
  } else {
    console.log('   ⚠️  No Firebase config found');
    console.log('   → Set FIREBASE_* environment variables in Render dashboard');
  }
}

function handleVercel(config, configPath) {
  console.log('\n📦 Vercel Configuration:');

  if (config && config.apiKey) {
    console.log('   ✓ Firebase env vars detected');
    console.log('   ✓ Vercel API will expose config from environment variables only');
  } else {
    console.log('   ⚠️  No Firebase config found');
    console.log('   → Set FIREBASE_* environment variables in Vercel dashboard');
  }
}

function handleCPanel(config, configPath) {
  console.log('\n📦 cPanel Configuration:');
  console.log('   Note: cPanel must use env vars or a .env outside public_html');

  if (config && config.apiKey) {
    console.log('   ✓ Firebase env vars detected');
    console.log('\n   📝 After building locally:');
    console.log('      1. Upload dist/ contents to public_html/ via cPanel File Manager');
    console.log('      2. Keep Firebase credentials in host env vars / .env outside public_html');
  } else {
    console.log('   ⚠️  No Firebase config found');
    console.log('\n   📝 Before deploying to cPanel:');
    console.log('      1. Add FIREBASE_* env vars or use install-helper.php to write .env outside public_html');
    console.log('      2. Build locally: npm run build');
    console.log('      3. Upload dist/ to public_html/ via cPanel');
  }
}

function handleVPS(config, configPath) {
  console.log('\n📦 VPS Configuration:');

  if (config && config.apiKey) {
    console.log('   ✓ Firebase env vars detected');
    console.log('\n   📝 Deployment instructions:');
    console.log('      1. Build locally: npm run build:vps');
    console.log('      2. Copy dist/ to server: rsync -av dist/ user@server:/app/');
    console.log('      3. Run: npm install && npm start');
  } else {
    console.log('   ⚠️  No Firebase config found');
    console.log('\n   📝 To deploy:');
    console.log('      1. Set VITE_FIREBASE_* in your .env file');
    console.log('      2. Run: npm run build:vps');
    console.log('      3. Copy to server and start the app');
  }
}

function handleLocal(config, configPath) {
  console.log('\n📦 Local/Development Configuration:');

  if (config && config.apiKey) {
    console.log('   ✓ Firebase env vars detected');
  } else {
    console.log('   ⚠️  Firebase config is empty');
    console.log('   → Run with VITE_FIREBASE_* environment variables');
    console.log('   → OR use the InstallWizard in the browser');
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════════

function detectPlatform() {
  if (process.env.RENDER === 'true') return 'render';
  if (process.env.RENDER_GIT_REPO) return 'render';
  if (process.env.VERCEL === '1') return 'vercel';
  if (process.env.VERCEL_ENV) return 'vercel';
  return 'local';
}

function parseEnvFile(content) {
  const config = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed) continue;

    const [key, ...valueParts] = trimmed.split('=');
    const value = valueParts.join('=').replace(/^["']|["']$/g, '');

    if (key === 'VITE_FIREBASE_API_KEY') config.apiKey = value;
    if (key === 'VITE_FIREBASE_AUTH_DOMAIN') config.authDomain = value;
    if (key === 'VITE_FIREBASE_PROJECT_ID') config.projectId = value;
    if (key === 'VITE_FIREBASE_STORAGE_BUCKET') config.storageBucket = value;
    if (key === 'VITE_FIREBASE_MESSAGING_SENDER_ID') config.messagingSenderId = value;
    if (key === 'VITE_FIREBASE_APP_ID') config.appId = value;
    if (key === 'VITE_FIREBASE_DATABASE_ID') config.databaseId = value || '(default)';
  }

  return Object.keys(config).length > 0 ? config : null;
}
