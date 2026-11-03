import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from 'firebase/app-check';
import { GoogleAuthProvider, getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

export const FIREBASE_PROJECT_ID = 'returnbond-7c6ae';

const envApiKey = (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined)?.trim() ?? '';
const envProjectId =
  (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined)?.trim() || FIREBASE_PROJECT_ID;
const envAuthDomain =
  (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined)?.trim() ||
  `${envProjectId}.firebaseapp.com`;
const envStorageBucket =
  (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined)?.trim() ||
  `${envProjectId}.firebasestorage.app`;
const envMessagingSenderId =
  (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined)?.trim() || undefined;
const envAppId = (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined)?.trim() || undefined;
const envDatabaseId =
  (import.meta.env.VITE_FIREBASE_DATABASE_ID as string | undefined)?.trim() ?? '';
const envReCaptchaSiteKey =
  (import.meta.env.VITE_FIREBASE_RECAPTCHA_SITE_KEY as string | undefined)?.trim() ?? '';

export const isFirebaseConfigured: boolean =
  envApiKey.length > 10 && Boolean(envProjectId);

export const isAppCheckConfigured: boolean = Boolean(isFirebaseConfigured && envReCaptchaSiteKey);

const firebaseConfig: FirebaseOptions = {
  apiKey: envApiKey,
  authDomain: envAuthDomain,
  projectId: envProjectId,
  storageBucket: envStorageBucket,
  ...(envMessagingSenderId ? { messagingSenderId: envMessagingSenderId } : {}),
  ...(envAppId ? { appId: envAppId } : {}),
};

export const firebaseApp: FirebaseApp | null = isFirebaseConfigured
  ? getApps().length > 0
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

let appCheckInstance: AppCheck | null = null;
if (firebaseApp && envReCaptchaSiteKey && typeof window !== 'undefined' && !appCheckInstance) {
  try {
    appCheckInstance = initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaV3Provider(envReCaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    // Prevent duplicate App Check initialization during HMR in development
  }
}

export const firebaseAppCheck: AppCheck | null = appCheckInstance;

export const firestoreDb: Firestore | null = firebaseApp
  ? envDatabaseId && envDatabaseId !== '(default)'
    ? getFirestore(firebaseApp, envDatabaseId)
    : getFirestore(firebaseApp)
  : null;

export const firebaseAuth: Auth | null = firebaseApp ? getAuth(firebaseApp) : null;
export const googleAuthProvider = new GoogleAuthProvider();

const CLIENT_TOKEN_STORAGE_KEY = 'returnbond_client_submission_token_v1';
const LAST_REVIEW_TS_KEY = 'returnbond_last_review_submitted_at_v1';
const LAST_FEEDBACK_TS_KEY = 'returnbond_last_feedback_submitted_at_v1';

function generateRandomToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${crypto.randomUUID()}-${Date.now().toString(36)}`;
  }
  const bytes = new Uint8Array(24);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `rb-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreateClientToken(): string {
  try {
    const existing = window.localStorage.getItem(CLIENT_TOKEN_STORAGE_KEY);
    if (existing && existing.length >= 16 && existing.length <= 128) {
      return existing;
    }
    const created = generateRandomToken();
    window.localStorage.setItem(CLIENT_TOKEN_STORAGE_KEY, created);
    return created;
  } catch {
    return generateRandomToken();
  }
}

function fallbackDeterministicHex64(input: string): string {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5];
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    for (let s = 0; s < seeds.length; s++) {
      seeds[s] = Math.imul(seeds[s] ^ (code + s * 31), 0x01000193) >>> 0;
    }
  }
  return seeds.map((n) => n.toString(16).padStart(8, '0')).join('');
}

export async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const encoded = new TextEncoder().encode(input);
    const buffer = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return fallbackDeterministicHex64(input);
}

export function getRecentLocalReviewTimestamp(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_REVIEW_TS_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function recordLocalReviewTimestamp(): void {
  try {
    window.localStorage.setItem(LAST_REVIEW_TS_KEY, String(Date.now()));
  } catch {
    // Ignore storage restrictions; Firestore rules remain authoritative.
  }
}

export function getRecentLocalFeedbackTimestamp(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_FEEDBACK_TS_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function recordLocalFeedbackTimestamp(): void {
  try {
    window.localStorage.setItem(LAST_FEEDBACK_TS_KEY, String(Date.now()));
  } catch {
    // Ignore storage restrictions; Firestore rules remain authoritative.
  }
}
