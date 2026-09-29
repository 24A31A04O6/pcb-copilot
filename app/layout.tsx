import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'

import { ZeroLogo } from '@/components/ZeroLogo'

import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://pcb-copilot.vercel.app'),
  title: {
    default: 'PCB-Copilot — brief to verified, manufacturable PCB',
    template: '%s · PCB-Copilot',
  },
  description:
    'Turn a plain-English engineering brief into a real tscircuit PCB design: schematic, routed board, 3D, checks, and Gerber/BOM exports unlocked only after automated verification.',
  applicationName: 'PCB-Copilot',
  generator: 'pcb-copilot',
  keywords: [
    'PCB',
    'tscircuit',
    'circuit-json',
    'Gerber',
    'Fireworks AI',
    'electronics',
    'PCB design automation',
    'manufacturing',
  ],
  authors: [{ name: 'PCB-Copilot' }],
  openGraph: {
    type: 'website',
    title: 'PCB-Copilot — brief to verified, manufacturable PCB',
    description:
      'Describe a board in plain English. ZERO writes tscircuit source, compiles it in a sandbox, runs connectivity and fab checks, repairs failures, and unlocks manufacturing files only when everything passes.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'PCB-Copilot' }],
    siteName: 'PCB-Copilot',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PCB-Copilot',
    description: 'Plain English in. Verified, manufacturable PCB out.',
    images: ['/og.png'],
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180' }],
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  // Light only, always. There is no dark theme in this app.
  colorScheme: 'light',
  themeColor: '#22D3EE',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/*
          Registered only in production and only from a secure context. A service worker in
          dev caches the very modules HMR is trying to replace, which produces a debugging
          session nobody can reason about. See public/sw.js for what it does and does not
          cache: the app shell yes, the API never.
        */}
        {process.env.NODE_ENV === 'production' && (
          <script
            dangerouslySetInnerHTML={{
              __html: `if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}`,
            }}
          />
        )}
      </head>
      <body className="h-full bg-[var(--paper)] text-[var(--ink)] antialiased">
        <a
          href="#main"
          className="brutal-sm sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-bold"
        >
          Skip to content
        </a>
        <span className="sr-only">
          <ZeroLogo />
        </span>
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
