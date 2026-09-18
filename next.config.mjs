/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  transpilePackages: [
    '@tscircuit/pcb-viewer',
    '@tscircuit/schematic-viewer',
    '@tscircuit/3d-viewer',
    '@tscircuit/core',
  ],
  serverExternalPackages: [
    '@tscircuit/checks',
    '@tscircuit/eval',
    'circuit-json-to-bom-csv',
    'circuit-json-to-gerber',
    'circuit-json-to-pnp-csv',
    'jszip',
  ],
  turbopack: {},
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000',
          },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy-Report-Only',
            value:
              "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https:; worker-src 'self' blob:; font-src 'self' data:; frame-ancestors 'self'",
          },
        ],
      },
    ]
  },
}

export default nextConfig
