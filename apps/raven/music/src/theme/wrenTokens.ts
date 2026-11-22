/*
 * Wren's design tokens, from the redesign handoff's `design/redesign/tokens/tokens.json`: the
 * dark and light palettes, the two faces, the type scale, radii, spacing and fixed sizes.
 * app.config.ts reads this file by relative path, so it imports nothing.
 */

/** The two palettes Wren draws with. */
export const COLOR_SCHEMES = { dark: 'dark', light: 'light' } as const

export type ColorScheme = (typeof COLOR_SCHEMES)[keyof typeof COLOR_SCHEMES]

/** The logo's own colours, fixed in every theme. The eye red is the logo's alone, never UI. */
export const BRAND = {
  night: '#15201e',
  bark: '#e6e1d6',
  ink: '#131416',
  eyeRed: '#c41725',
  leaf: '#a8262f',
  paper: '#f1ece2',
} as const

/** The handoff's art colours, fixed in every theme: Search's Browse tiles wear them in pairs. */
export const ART = {
  ink: '#1e1f22',
  ochre: '#d9a43f',
  dusk: '#3a3e57',
  blush: '#e0b8a0',
  slate: '#4d6c8c',
  cream: '#efe7d8',
  pine: '#2e4a44',
  sand: '#e8dcc4',
} as const

const DARK = {
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
  shadow: 'rgba(0,0,0,0.45)',
} as const

/** Every colour a screen paints with, by what it is for. */
export type Palette = { readonly [K in keyof typeof DARK]: string }

const LIGHT = {
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
  shadow: 'rgba(40,30,20,0.14)',
} as const satisfies Palette

/** Each scheme's palette. */
export const COLORS = {
  [COLOR_SCHEMES.dark]: DARK,
  [COLOR_SCHEMES.light]: LIGHT,
} as const satisfies Record<ColorScheme, Palette>

/**
 * The faces, by PostScript name. The files in `assets/fonts` carry the same names, so the name is
 * the family on both platforms: iOS finds a face by its PostScript name, and Android by its file.
 * Each weight is its own family, so no style ever sets `fontWeight`.
 */
export const FONTS = {
  display: 'YoungSerif-Regular',
  body: 'InstrumentSans-Regular',
  bodyMedium: 'InstrumentSans-Medium',
  bodySemiBold: 'InstrumentSans-SemiBold',
} as const

/** The font files app.config.ts embeds, one per face. */
export const FONT_FILES = Object.values(FONTS).map((face) => `./assets/fonts/${face}.ttf`)

/** The type scale: Young Serif for identity, Instrument Sans for everything else. */
export const TYPE = {
  largeTitle: { fontFamily: FONTS.display, fontSize: 34, lineHeight: 40 },
  tabletTitle: { fontFamily: FONTS.display, fontSize: 38, lineHeight: 44 },
  albumTitle: { fontFamily: FONTS.display, fontSize: 26, lineHeight: 32 },
  artistName: { fontFamily: FONTS.display, fontSize: 44, lineHeight: 50 },
  lyric: { fontFamily: FONTS.display, fontSize: 27, lineHeight: 35 },
  /** Now Playing's artist link, and the compact head's title. */
  playerArtist: { fontFamily: FONTS.body, fontSize: 17, lineHeight: 22 },
  compactTitle: { fontFamily: FONTS.bodySemiBold, fontSize: 17, lineHeight: 22 },
  paneTitle: { fontFamily: FONTS.bodySemiBold, fontSize: 18, lineHeight: 24 },
  /** Now Playing's bottom bar: the Output pill's words. */
  control: { fontFamily: FONTS.bodyMedium, fontSize: 13, lineHeight: 18 },
  emptyTitle: { fontFamily: FONTS.display, fontSize: 24, lineHeight: 30 },
  dialogTitle: { fontFamily: FONTS.display, fontSize: 23, lineHeight: 29 },
  section: { fontFamily: FONTS.bodySemiBold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  rowTitle: { fontFamily: FONTS.bodyMedium, fontSize: 16, lineHeight: 21 },
  /** Library's categories and an album's artist links. */
  rowLarge: { fontFamily: FONTS.bodyMedium, fontSize: 17, lineHeight: 21 },
  /** A link in words beside a heading or in a card: See all, Clear, Manage. */
  link: { fontFamily: FONTS.bodyMedium, fontSize: 15, lineHeight: 21 },
  /** Continue listening's album title on a phone. */
  cardTitle: { fontFamily: FONTS.display, fontSize: 20, lineHeight: 26 },
  rowStrong: { fontFamily: FONTS.bodySemiBold, fontSize: 15, lineHeight: 20 },
  button: { fontFamily: FONTS.bodySemiBold, fontSize: 15, lineHeight: 20 },
  body: { fontFamily: FONTS.body, fontSize: 15, lineHeight: 22 },
  input: { fontFamily: FONTS.body, fontSize: 16, lineHeight: 21 },
  meta: { fontFamily: FONTS.body, fontSize: 13, lineHeight: 18 },
  metaStrong: { fontFamily: FONTS.bodySemiBold, fontSize: 13, lineHeight: 18 },
  tileTitle: { fontFamily: FONTS.bodySemiBold, fontSize: 14, lineHeight: 19 },
  time: { fontFamily: FONTS.body, fontSize: 14, lineHeight: 18, fontVariant: ['tabular-nums'] },
  small: { fontFamily: FONTS.body, fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'] },
  /** The word under an album's or a playlist's action on a phone. */
  actionLabel: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  overline: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.72,
    textTransform: 'uppercase',
  },
  tab: { fontFamily: FONTS.bodyMedium, fontSize: 11, lineHeight: 14 },
  tabActive: { fontFamily: FONTS.bodySemiBold, fontSize: 11, lineHeight: 14 },
} as const

export const RADIUS = {
  xs: 6,
  thumb: 8,
  sm: 10,
  item: 12,
  md: 14,
  lg: 16,
  /** Now Playing's large cover. */
  art: 18,
  xl: 26,
  sheet: 28,
  /** Home's Continue listening card. */
  feature: 20,
  pill: 999,
} as const

export const SPACE = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, s8: 32, s10: 40 } as const

/** The kit's fixed sizes, in points: its controls, rows, icons, art and lines. */
export const SIZE = {
  touchTarget: 44,
  button: 48,
  buttonLarge: 52,
  field: 52,
  searchField: 46,
  searchFieldCompact: 42,
  row: 60,
  navRow: 56,
  artistRow: 64,
  tabBar: 84,
  miniPlayer: 60,
  gutter: 20,
  icon: 22,
  smallIcon: 18,
  navIcon: 20,
  largeIcon: 26,
  emptyIcon: 34,
  check: 16,
  stroke: 1.75,
  activeStroke: 2,
  hairline: 1,
  focusRing: 2,
  progressLine: 2,
  smallButton: 36,
  playButton: 44,
  segment: 30,
  segmentInset: 3,
  segmentGap: 2,
  chip: 34,
  statusChip: 32,
  statusDot: 8,
  iconTile: 32,
  dialogIcon: 48,
  dialog: 360,
  dialogInset: 28,
  emptyTile: 80,
  emptyMeasure: 300,
  rowGap: 14,
  rowArt: 44,
  trackNumber: 24,
  avatar: 48,
  miniArt: 40,
  sheetArt: 52,
  /** An album tile on a shelf that scrolls sideways: Home's Recently added and Search's albums. */
  shelfTile: 148,
  floatInset: 10,
  tabPillWidth: 52,
  tabPillHeight: 30,
  grabberWidth: 40,
  grabberHeight: 5,
  lockup: 34,
  scrubTrack: 5,
  scrubThumb: 14,
  equalizer: 14,
  equalizerBar: 3,
  equalizerGap: 2,
  equalizerRadius: 2,
} as const

/** The tablet's shell: the sidebar, its rail, the player bar and the pages' margins. */
export const SHELL_SIZES = {
  tabletSidebar: 256,
  tabletRail: 76,
  sidebarItem: 42,
  tabletPlayerBar: 84,
  barArt: 52,
  /** The player bar's middle: its transport over its scrubber. */
  scrubber: 420,
  tabletPadTop: 36,
  tabletPadSide: 40,
} as const

/** Now Playing: its gutter, covers, transport, columns and Up next's head. */
export const PLAYER_SIZES = {
  gutter: 28,
  art: 334,
  tabletArt: 350,
  compactArt: 56,
  playLarge: 76,
  playCompact: 64,
  playQueue: 60,
  transportButton: 56,
  transportSmall: 48,
  toggleCircle: 40,
  upNextHeadTop: 6,
  upNextHeadBottom: 10,
} as const

/** Search: its Browse tiles, the top result's art and the artists' circles. */
export const SEARCH_SIZES = {
  browseTile: 84,
  topResultArt: 64,
  artistCircle: 76,
  artistCircleItem: 88,
} as const

/** An album's, an artist's and a playlist's pages. */
export const DETAIL_SIZES = {
  /** The left column of a tablet's album or playlist: its cover, title and actions. */
  tabletColumn: 300,
  cover: 236,
  tabletCover: 300,
  hero: 300,
  tabletHero: 250,
  /** How tall Add to playlist's list grows before it scrolls: six rows. */
  playlistList: 360,
} as const

/** Home: the Continue listening card's art on each layout. */
export const HOME_SIZES = {
  continueArt: 96,
  tabletContinueArt: 132,
} as const

/** Sign-in, from the handoff's P01 and T01. */
export const SIGN_IN_SIZES = {
  /** The phone's mark, 76 wide. */
  mark: 76,
  /** The tablet's large mark, at most 300 wide. */
  heroMark: 300,
  /** The tablet's lockup, 44 tall. */
  lockup: 44,
  /** How wide the tablet's form grows. */
  formWidth: 400,
  /** How wide the tablet's tagline runs. */
  taglineWidth: 420,
  /** The tablet's Night panel's inset, and how far below the status bar the phone's mark sits. */
  inset: 56,
} as const

/** How a screen lays itself out: a phone's one column, or a tablet's wider one. */
export const FORM_FACTORS = { phone: 'phone', tablet: 'tablet' } as const

export type FormFactor = (typeof FORM_FACTORS)[keyof typeof FORM_FACTORS]

/** The tablet layout starts where the screen's shortest side reaches this width. */
export const BREAKPOINTS = { tablet: 744 } as const

/**
 * How faint a control is drawn while a finger holds it and while it is turned off, and how
 * faint a lyric line is once sung.
 */
export const OPACITIES = { pressed: 0.85, disabled: 0.4, sung: 0.55 } as const

/** How long a sheet or Now Playing takes to rise, in milliseconds. */
export const MOTION = { sheet: 320 } as const
