import type { NextConfig } from 'next';

/**
 * Security headers (SYSTEM_DESIGN §12). CSP is kept permissive for inline styles because the
 * poster-adaptive background is set via inline CSS custom properties (DESIGN §4), and for inline
 * scripts because Next streams the RSC payload in inline <script> tags (a nonce-based CSP needs
 * per-request nonces from proxy.ts; follow-up in docs/05-review/REVIEW.md). Even so it pins every
 * fetch, image, font, frame, form target and <base> to known origins, and blocks plugins/framing.
 * Browsers only ever talk to our own origin plus image.tmdb.org (ADR-007); Supabase is server-side.
 */
const isDev = process.env.NODE_ENV !== 'production';
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://image.tmdb.org",
  "font-src 'self'",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Posters are hot-linked from TMDB's CDN at fixed sizes (ADR-007); we never proxy/optimise them.
  images: {
    unoptimized: true,
    remotePatterns: [{ protocol: 'https', hostname: 'image.tmdb.org', pathname: '/t/p/**' }],
  },
  // sharp is only used by offline scripts (sync job, fixture builder), never by the app.
  serverExternalPackages: ['sharp', '@electric-sql/pglite'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
