/**
 * Build-time configuration (Vite env). Firebase web config values are public
 * identifiers, not secrets. Never put an App Check debug token here: it would
 * end up in the distributable bundle.
 */
const env = import.meta.env;

export const config = {
  firebase: {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
  },
  /** Must be a model enabled for your Firebase AI Logic backend; verify before demoing. */
  cloudModel: env.VITE_CLOUD_MODEL || 'gemini-2.5-flash',
  demoUrl: env.VITE_DEMO_URL ?? '',
};
