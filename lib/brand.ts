/**
 * The design tokens, as data.
 *
 * `app/globals.css` defines the same values as CSS custom properties for the running app;
 * this module is the copy the icon and Open Graph builders draw with. Keeping the palette
 * in one TypeScript file and referencing it from both sides is what stops the social card
 * from being a different brand from the page.
 *
 * Phase 5, "exact tokens". Any change here is a change in `globals.css` too.
 */
export const BRAND = {
  paper: '#f2fbfc',
  surface: '#ffffff',
  cyan: '#22d3ee',
  cyanDeep: '#0891b2',
  cyanTint: '#cffafe',
  ink: '#0b1b1f',
  inkSoft: '#3d5359',
  warn: '#ffe14d',
  error: '#ff6b6b',
  success: '#5eead4',
} as const

/** Hard, unmixed shadows. Never a blur: the style is neobrutalist. */
export const SHADOWS = { sm: 3, md: 6, lg: 9 } as const

export const BORDER = 3

export const APP_NAME = 'PCB-Copilot'
export const APP_TAGLINE = 'Plain English to verified PCB'
export const APP_DESCRIPTION =
  'Describe a board in plain English. Get a compiled, checked tscircuit design with Gerbers, a BOM and pick-and-place you can actually send to a fab.'
