import { Analytics } from '@vercel/analytics/next'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import type { Metadata, Viewport } from 'next'

import './globals.css'

const geistSans = GeistSans

const geistMono = GeistMono

export const metadata: Metadata = {
  title: 'PCB Copilot — Brutal PCB Engineering • Cyan & White',
  description:
    'Generate, compile, verify, visualize, and export real tscircuit PCB designs with Fireworks AI. Neobrutalism cyan-and-white UI, live generation, robust review, end-to-end manufacturing.',
  generator: 'pcb-copilot-v2-brutal',
  keywords: ['PCB', 'tscircuit', 'Fireworks AI', 'neobrutalism', 'electronics', 'manufacturing'],
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#00E5FF' },
    { media: '(prefers-color-scheme: dark)', color: '#00E5FF' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="h-full font-mono antialiased bg-white text-black selection:bg-[#00E5FF] selection:text-black">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
