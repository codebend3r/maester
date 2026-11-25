/*
 * Wren theme objects. Works for React Native (StyleSheet) and web (CSS-in-JS).
 * Source of truth: tokens.json. Keep the two in sync.
 */

export const brand = {
  night: '#15201e',
  bark: '#e6e1d6',
  ink: '#131416',
  eyeRed: '#c41725', // logo eye only, never UI
  leaf: '#a8262f',
  paper: '#f1ece2',
} as const;

const dark = {
  bg: '#101816',
  surface: '#17211e',
  surface2: '#1f2b27',
  raised: '#1b2622',
  field: '#17211e',
  line: 'rgba(230,225,214,0.08)',
  line2: 'rgba(230,225,214,0.15)',
  text: '#efebe3',
  text2: '#b3b8b1',
  text3: '#89928d',
  accent: '#b8323b',
  accentInk: '#ffffff',
  accentText: '#f2858a',
  accentSoft: 'rgba(242,133,138,0.13)',
  ok: '#7fc4a4',
  scrim: 'rgba(4,8,7,0.66)',
};

const light: typeof dark = {
  bg: '#f4efe6',
  surface: '#fbf8f2',
  surface2: '#e9e3d7',
  raised: '#ffffff',
  field: '#ffffff',
  line: 'rgba(19,20,22,0.08)',
  line2: 'rgba(19,20,22,0.14)',
  text: '#131416',
  text2: '#474a47',
  text3: '#5f615c',
  accent: '#a8262f',
  accentInk: '#ffffff',
  accentText: '#a8262f',
  accentSoft: 'rgba(168,38,47,0.08)',
  ok: '#2f7a57',
  scrim: 'rgba(19,20,22,0.36)',
};

export const colors = { dark, light };
export type ColorScheme = keyof typeof colors;
export type ThemeColors = typeof dark;

export const fonts = {
  display: 'YoungSerif-Regular',
  body: 'InstrumentSans-Regular',
  bodyMedium: 'InstrumentSans-Medium',
  bodySemiBold: 'InstrumentSans-SemiBold',
} as const;

export const type = {
  largeTitle: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40 },
  tabletTitle: { fontFamily: fonts.display, fontSize: 38, lineHeight: 44 },
  albumTitle: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32 },
  lyric: { fontFamily: fonts.display, fontSize: 27, lineHeight: 35 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30 },
  section: { fontFamily: fonts.bodySemiBold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  rowTitle: { fontFamily: fonts.bodyMedium, fontSize: 16, lineHeight: 21 },
  button: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 20 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  meta: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  overline: { fontFamily: fonts.bodySemiBold, fontSize: 12, lineHeight: 16, letterSpacing: 0.72, textTransform: 'uppercase' as const },
  tab: { fontFamily: fonts.bodyMedium, fontSize: 11, lineHeight: 14 },
} as const;

export const radius = { xs: 6, sm: 10, md: 14, lg: 16, xl: 26, sheet: 28, pill: 999 } as const;
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 } as const;
export const size = {
  touchTarget: 44,
  button: 48,
  buttonLarge: 52,
  field: 52,
  row: 60,
  tabBar: 84,
  miniPlayer: 60,
  tabletSidebar: 256,
  tabletPlayerBar: 84,
} as const;

/** Tablet layout kicks in at this shortest-side width. */
export const breakpoints = { tablet: 744 } as const;

export function getTheme(scheme: ColorScheme) {
  return { scheme, colors: colors[scheme], fonts, type, radius, space, size, brand };
}
export type Theme = ReturnType<typeof getTheme>;
