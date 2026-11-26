import { WREN_THEMES, type WrenThemeName } from '@/themes'

/*
 * Wren's colours, from the redesign handoff's `design/redesign/tokens/tokens.json`: the logo's and
 * the art's fixed colours, and each theme's palette. The apps on React Native paint with these, and
 * Wren on the web's `globals.scss` holds the same values.
 */

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
  slate: '#4a6988',
  cream: '#efe7d8',
  pine: '#2e4a44',
  sand: '#e8dcc4',
} as const

/** Wren's own dark, and its default. */
const NIGHT = {
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

/** What sits on a picture, the same in every theme: Night's text on its scrim. */
export const ON_PICTURE = { veil: NIGHT.scrim, ink: NIGHT.text } as const

/** Every colour a screen paints with, by what it is for. */
export type Palette = { readonly [K in keyof typeof NIGHT]: string }

/** Wren's own light. */
const PAPER = {
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

/** The brand's red is the ground, and cream does the accent's work. */
const GARNET = {
  bg: '#b8323b',
  surface: '#a82a33',
  surface2: '#98232c',
  raised: '#c4434b',
  field: '#98232c',
  line: 'rgba(255,244,234,0.16)',
  line2: 'rgba(255,244,234,0.3)',
  text: '#ffffff',
  text2: '#ffe9e6',
  text3: '#fbdcd8',
  accent: '#fff4ea',
  accentInk: '#8f1f29',
  accentText: '#fff4ea',
  accentSoft: 'rgba(255,244,234,0.16)',
  ok: '#c8f0d8',
  scrim: 'rgba(60,8,12,0.66)',
  shadow: 'rgba(60,8,12,0.4)',
} as const satisfies Palette

/** Garnet's light partner: rose paper under the same red. */
const BLUSH = {
  bg: '#f8ecea',
  surface: '#fdf6f4',
  surface2: '#f0dcd9',
  raised: '#ffffff',
  field: '#ffffff',
  line: 'rgba(74,16,22,0.09)',
  line2: 'rgba(74,16,22,0.16)',
  text: '#2a0f12',
  text2: '#5c3d40',
  text3: '#76575a',
  accent: '#b8323b',
  accentInk: '#ffffff',
  accentText: '#a8262f',
  accentSoft: 'rgba(184,50,59,0.1)',
  ok: '#2f7a57',
  scrim: 'rgba(42,15,18,0.36)',
  shadow: 'rgba(74,16,22,0.14)',
} as const satisfies Palette

/** Cool green paper with a deep green accent. */
const MINT = {
  bg: '#e9f5ee',
  surface: '#f4faf6',
  surface2: '#d6eadf',
  raised: '#ffffff',
  field: '#ffffff',
  line: 'rgba(16,52,40,0.09)',
  line2: 'rgba(16,52,40,0.16)',
  text: '#10261e',
  text2: '#3b5248',
  text3: '#54695f',
  accent: '#17785a',
  accentInk: '#ffffff',
  accentText: '#0f6a4e',
  accentSoft: 'rgba(23,120,90,0.1)',
  ok: '#2f7a57',
  scrim: 'rgba(16,38,30,0.36)',
  shadow: 'rgba(16,52,40,0.14)',
} as const satisfies Palette

/** After the editor theme: its ground, foreground, purple and green. */
const DRACULA = {
  bg: '#282a36',
  surface: '#313442',
  surface2: '#3a3d4f',
  raised: '#44475a',
  field: '#21222c',
  line: 'rgba(248,248,242,0.08)',
  line2: 'rgba(248,248,242,0.16)',
  text: '#f8f8f2',
  text2: '#c5c8dc',
  text3: '#a4aed6',
  accent: '#bd93f9',
  accentInk: '#282a36',
  accentText: '#c9a6ff',
  accentSoft: 'rgba(189,147,249,0.16)',
  ok: '#50fa7b',
  scrim: 'rgba(15,16,22,0.66)',
  shadow: 'rgba(0,0,0,0.45)',
} as const satisfies Palette

/** Deep navy with a sky blue accent. */
const MIDNIGHT = {
  bg: '#0e1524',
  surface: '#151e31',
  surface2: '#1e2a42',
  raised: '#1a2439',
  field: '#151e31',
  line: 'rgba(222,231,247,0.08)',
  line2: 'rgba(222,231,247,0.16)',
  text: '#e9eef8',
  text2: '#b1bcd0',
  text3: '#8a97b0',
  accent: '#7cb7ff',
  accentInk: '#0e1524',
  accentText: '#8fc2ff',
  accentSoft: 'rgba(124,183,255,0.15)',
  ok: '#7fd4b0',
  scrim: 'rgba(4,8,16,0.66)',
  shadow: 'rgba(0,0,0,0.45)',
} as const satisfies Palette

/** Banana yellow paper with a stem brown accent. */
const BANANA = {
  bg: '#fcefa8',
  surface: '#fff7cc',
  surface2: '#f3e08a',
  raised: '#ffffff',
  field: '#fffdf0',
  line: 'rgba(64,48,0,0.1)',
  line2: 'rgba(64,48,0,0.18)',
  text: '#2b2204',
  text2: '#54471a',
  text3: '#6b5d2a',
  accent: '#7a5200',
  accentInk: '#fff8d6',
  accentText: '#7a5200',
  accentSoft: 'rgba(122,82,0,0.1)',
  ok: '#2f7a57',
  scrim: 'rgba(43,34,4,0.36)',
  shadow: 'rgba(64,48,0,0.16)',
} as const satisfies Palette

/** Warm charcoal with an orange accent. */
const EMBER = {
  bg: '#17120f',
  surface: '#201915',
  surface2: '#2c231d',
  raised: '#251d18',
  field: '#201915',
  line: 'rgba(245,232,220,0.08)',
  line2: 'rgba(245,232,220,0.16)',
  text: '#f3ebe3',
  text2: '#bdb0a4',
  text3: '#9c8f83',
  accent: '#f28c28',
  accentInk: '#1c1109',
  accentText: '#ffa24a',
  accentSoft: 'rgba(242,140,40,0.15)',
  ok: '#7fc4a4',
  scrim: 'rgba(8,5,3,0.66)',
  shadow: 'rgba(0,0,0,0.45)',
} as const satisfies Palette

/**
 * Each theme's palette, by its name in `WREN_THEMES`. The phone and TV apps paint with these;
 * the web's `globals.scss` holds the same values.
 */
export const WREN_PALETTES = {
  [WREN_THEMES.night]: NIGHT,
  [WREN_THEMES.paper]: PAPER,
  [WREN_THEMES.garnet]: GARNET,
  [WREN_THEMES.blush]: BLUSH,
  [WREN_THEMES.mint]: MINT,
  [WREN_THEMES.dracula]: DRACULA,
  [WREN_THEMES.midnight]: MIDNIGHT,
  [WREN_THEMES.banana]: BANANA,
  [WREN_THEMES.ember]: EMBER,
} as const satisfies Record<WrenThemeName, Palette>
