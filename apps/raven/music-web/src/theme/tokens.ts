/*
 * The names of the tokens in `@/styles/globals.scss` a component is handed as a prop: a size,
 * a radius or a colour. Each value is the token's `var()`, so the stylesheet stays the one place
 * a value is written and a prop never carries a number; `tokens.test.ts` checks every name here
 * is declared there. It holds only the tokens some component is handed: one a stylesheet alone
 * reads has no key here, and gets one when a prop first needs it.
 */

import type { CSSProperties } from 'react'

/** A fixed size of the kit or of one area, by the apps' `SIZE` names: `SIZES.rowArt`. */
export const SIZES = {
  touchTarget: 'var(--size-touch-target)',
  button: 'var(--size-button)',
  icon: 'var(--size-icon)',
  smallIcon: 'var(--size-small-icon)',
  navIcon: 'var(--size-nav-icon)',
  largeIcon: 'var(--size-large-icon)',
  emptyIcon: 'var(--size-empty-icon)',
  smallButton: 'var(--size-small-button)',
  playButton: 'var(--size-play-button)',
  playBar: 'var(--size-play-bar)',
  rowArt: 'var(--size-row-art)',
  avatar: 'var(--size-avatar)',
  artistPhoto: 'var(--size-artist-photo)',
  miniArt: 'var(--size-mini-art)',
  sheetArt: 'var(--size-sheet-art)',
  lockup: 'var(--size-lockup)',
  barArt: 'var(--size-bar-art)',
  playerCompactArt: 'var(--size-player-compact-art)',
  playLarge: 'var(--size-play-large)',
  playCompact: 'var(--size-play-compact)',
  playQueue: 'var(--size-play-queue)',
  transportButton: 'var(--size-transport-button)',
  transportSmall: 'var(--size-transport-small)',
  toggleCircle: 'var(--size-toggle-circle)',
  topResultArt: 'var(--size-top-result-art)',
  artistCircle: 'var(--size-artist-circle)',
  continueArt: 'var(--size-continue-art)',
  continueArtWide: 'var(--size-continue-art-wide)',
  loadingMark: 'var(--size-loading-mark)',
  signInMark: 'var(--size-sign-in-mark)',
  signInHeroMark: 'var(--size-sign-in-hero-mark)',
  signInLockup: 'var(--size-sign-in-lockup)',
} as const

export type Size = (typeof SIZES)[keyof typeof SIZES]

/** A corner radius: `RADII.thumb`. */
export const RADII = {
  xs: 'var(--radius-xs)',
  thumb: 'var(--radius-thumb)',
  sm: 'var(--radius-sm)',
  item: 'var(--radius-item)',
  md: 'var(--radius-md)',
  art: 'var(--radius-art)',
} as const

export type Radius = (typeof RADII)[keyof typeof RADII]

/** A colour of the palette showing, or one of the brand's fixed ones: `COLORS.text2`. */
export const COLORS = {
  bg: 'var(--color-bg)',
  surface2: 'var(--color-surface-2)',
  text: 'var(--color-text)',
  text2: 'var(--color-text-2)',
  text3: 'var(--color-text-3)',
  accent: 'var(--color-accent)',
  accentInk: 'var(--color-accent-ink)',
  accentText: 'var(--color-accent-text)',
  accentSoft: 'var(--color-accent-soft)',
  bark: 'var(--color-bark)',
  pictureInk: 'var(--color-picture-ink)',
  pictureVeil: 'var(--color-picture-veil)',
  artInk: 'var(--color-art-ink)',
  artOchre: 'var(--color-art-ochre)',
  artDusk: 'var(--color-art-dusk)',
  artBlush: 'var(--color-art-blush)',
  artSlate: 'var(--color-art-slate)',
  artCream: 'var(--color-art-cream)',
} as const

export type Color = (typeof COLORS)[keyof typeof COLORS]

/**
 * The colour tokens code reads by name rather than hands a component: the theme's ground, which
 * the browser's bars wear, and the colours text is drawn in, whose contrast /design shows.
 */
export const COLOR_TOKEN_NAMES = {
  ground: '--color-bg',
  text: '--color-text',
  text2: '--color-text-2',
  text3: '--color-text-3',
  accentText: '--color-accent-text',
} as const

/** An inline style that sets a component's own custom properties from token names. */
export type TokenStyle = CSSProperties & Record<`--${string}`, string | undefined>
