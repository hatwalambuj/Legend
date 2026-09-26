import type { NextConfig } from 'next';

/**
 * Security headers (SYSTEM_DESIGN §12). CSP is kept permissive for inline styles because the
 * poster-adaptive background is set via inline CSS custom properties (DESIGN §4).
 */
const securityHeaders = [
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
