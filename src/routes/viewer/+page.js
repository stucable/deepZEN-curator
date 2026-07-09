// The image viewer opens as a FRESH document (window.open), not an in-app
// navigation — so /viewer must exist as a real static file. The shipped build is
// served by `python -m http.server`, which does no SPA-fallback rewrite, so the
// app-wide `fallback: 'index.html'` (svelte.config.js) can't rescue a deep hit on
// /viewer: it 404s. Prerendering this one route emits build/viewer/index.html, and
// trailingSlash:'always' makes it a directory index so http.server serves it at
// `/viewer/` (and 301-redirects `/viewer`). ssr stays false (see +layout.js), so
// prerender emits a client-only shell that hydrates in the opened window — the
// component's browser-only code (window.opener, postMessage) never runs at build.
export const prerender = true;
export const trailingSlash = 'always';
