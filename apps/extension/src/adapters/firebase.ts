import { initializeApp, type FirebaseApp } from 'firebase/app';
import { CustomProvider, initializeAppCheck } from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';
import { config } from '../config.ts';

/**
 * Firebase bootstrap. Side effects are isolated here and reported as an
 * explicit status object for the Diagnostics panel instead of failing silently.
 *
 * App Check in an extension: chrome-extension:// origins cannot pass a
 * reCAPTCHA attestation, so for development and judging we use an App Check
 * DEBUG token (allowed by the contest rules). The token is never bundled: the
 * user pastes it into Diagnostics, it lives in chrome.storage.local, and it is
 * applied before App Check initializes.
 */
export interface FirebaseStatus {
  configured: boolean;
  appCheck: 'debug-token' | 'off';
  problem?: string;
}

export const DEBUG_TOKEN_KEY = 'appCheckDebugToken';

let cached: Promise<{ app: FirebaseApp; ai: AI; status: FirebaseStatus } | { status: FirebaseStatus }> | undefined;

export function initFirebase() {
  cached ??= (async () => {
    if (!config.firebase.apiKey || !config.firebase.projectId || !config.firebase.appId) {
      return { status: { configured: false, appCheck: 'off', problem: 'Firebase config missing: copy .env.example to .env and rebuild.' } as FirebaseStatus };
    }
    const app = initializeApp(config.firebase);
    const stored = await chrome.storage.local.get(DEBUG_TOKEN_KEY);
    const debugToken = typeof stored[DEBUG_TOKEN_KEY] === 'string' ? (stored[DEBUG_TOKEN_KEY] as string) : '';
    let appCheck: FirebaseStatus['appCheck'] = 'off';
    let problem: string | undefined;
    if (debugToken) {
      (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
      // In debug mode the SDK exchanges the debug token itself; the provider is
      // never asked for a token. A reCAPTCHA provider would try to inject a
      // remote script, which MV3's CSP forbids, so we pass an inert one.
      initializeAppCheck(app, {
        provider: new CustomProvider({
          getToken: () => Promise.reject(new Error('Only debug-token App Check is supported in the extension.')),
        }),
        isTokenAutoRefreshEnabled: true,
      });
      appCheck = 'debug-token';
    } else {
      problem = 'App Check not configured: paste a debug token in Diagnostics. Cloud calls fail while App Check is enforced.';
    }
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    return { app, ai, status: { configured: true, appCheck, ...(problem ? { problem } : {}) } };
  })();
  return cached;
}
