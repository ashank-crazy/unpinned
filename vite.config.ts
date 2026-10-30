/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';

// The published page may only talk to its own origin. Photos are never sent
// anywhere, and this policy makes that checkable: open the page source.
// Development builds skip it because Vite's live reload needs inline scripts.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "img-src 'self' blob: data:",
  "style-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'unpinned-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
      ),
  };
}

export default defineConfig({
  // Relative paths so the build works at a site root or under a GitHub Pages subpath.
  base: './',
  plugins: [contentSecurityPolicy()],
  server: { port: 5180, strictPort: true },
  preview: { port: 4180, strictPort: true },
  // The town list (about 300 KB compressed) is one chunk on purpose; it loads only for photos with GPS.
  build: { target: 'es2022', assetsInlineLimit: 0, sourcemap: true, chunkSizeWarningLimit: 700 },
  test: { include: ['tests/**/*.test.ts'] },
});
