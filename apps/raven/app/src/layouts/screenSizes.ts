/**
 * The web's breakpoints in points: from 48rem a screen is a tablet's, and from 64rem a wide
 * one's, where the web's cards grow again.
 */
export const BREAKPOINTS = { tablet: 48 * 16, wide: 64 * 16 } as const

type IsTabletProps = { width: number; height: number }

/**
 * Whether a screen is a tablet's: its shorter side reaches the web's 48rem, so a phone held
 * sideways, wider than that, is still a phone.
 */
export const isTablet = ({ width, height }: IsTabletProps): boolean =>
  Math.min(width, height) >= BREAKPOINTS.tablet
