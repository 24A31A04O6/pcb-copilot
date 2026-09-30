import type { MetadataRoute } from 'next'

/**
 * The web app manifest.
 *
 * The icons are the ones `scripts/build-icons.ts` draws from the same pixel data as the
 * mascot, so the installed app and the page agree. Sizes are declared rather than inferred
 * because a manifest with one 512 px icon gets a blurry dock icon on some platforms.
 */
export const dynamic = 'force-static'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'pcb-copilot — plain English to verified PCB',
    short_name: 'pcb-copilot',
    description:
      'Describe a circuit in plain English and get a tscircuit design that compiles, passes its fabrication checks, and exports as real manufacturing files.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0B0B0F',
    theme_color: '#00E5FF',
    categories: ['productivity', 'utilities'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'New design',
        short_name: 'New',
        description: 'Start a new design from a brief',
        url: '/?new=1',
      },
    ],
  }
}
