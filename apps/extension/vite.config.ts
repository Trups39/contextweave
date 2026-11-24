import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Adds the hosted demo origin (VITE_DEMO_URL) to the built manifest's
 * host_permissions, so the demo works without a broad permission prompt.
 */
function demoHostPermission(mode: string): Plugin {
  return {
    name: 'contextweave-demo-host',
    closeBundle() {
      const { VITE_DEMO_URL } = loadEnv(mode, import.meta.dirname, 'VITE_');
      let origin: string | undefined;
      try { origin = VITE_DEMO_URL ? new URL(VITE_DEMO_URL).origin : undefined; } catch { origin = undefined; }
      if (!origin || origin.includes('YOUR-PROJECT')) return;
      const file = resolve(import.meta.dirname, 'dist/manifest.json');
      const manifest = JSON.parse(readFileSync(file, 'utf8'));
      manifest.host_permissions = [`${origin}/*`];
      writeFileSync(file, JSON.stringify(manifest, null, 2));
    },
  };
}

// MV3 forbids remote code, so everything (including the Firebase SDK) is bundled.
export default defineConfig(({ mode }) => ({
  plugins: [demoHostPermission(mode)],
  root: resolve(import.meta.dirname, 'src'),
  publicDir: resolve(import.meta.dirname, 'public'),
  // root is src/, so point Vite at apps/extension/ for .env files.
  envDir: import.meta.dirname,
  base: '',
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome139',
    sourcemap: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, 'src/sidepanel/index.html'),
        background: resolve(import.meta.dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
}));
