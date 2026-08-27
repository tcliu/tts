// Literal class map (never interpolated) so Tailwind's scanner sees every
// candidate at this call site; the `@source inline(...)` rule in styles.css is
// defense-in-depth, asserted by tailwind-source.test.ts.
export const TEXT_SIZE = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-md',
  lg: 'text-lg',
} as const

export type TextSize = keyof typeof TEXT_SIZE
