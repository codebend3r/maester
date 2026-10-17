import type { LibraryIconName } from '@raven/core'
import styles from '@/components/Icon/Icon.module.scss'

/** Every icon a library can wear, and the app's own. */
export type IconName =
  | LibraryIconName
  | 'back'
  | 'plus'
  | 'rescan'
  | 'edit'
  | 'close'
  | 'check'
  | 'folder'
  | 'up'
  | 'download'
  | 'alert'
  | 'copy'
  | 'search'
  | 'trash'
  | 'more'
  | 'heart'
  | 'play'
  | 'pause'
  | 'rewind'
  | 'forward'
  | 'volume'
  | 'volumeLow'
  | 'muted'
  | 'captions'
  | 'settings'
  | 'fullscreen'
  | 'fullscreenExit'
  | 'keyboard'
  | 'pin'
  | 'grid'
  | 'list'
  | 'tiles'
  | 'grouped'
  | 'shuffle'
  | 'history'
  | 'next'
  | 'wand'
  | 'image'
  | 'ascending'
  | 'descending'
  | 'libraries'
  | 'home'
  | 'playback'
  | 'file-play'
  | 'convert'
  | 'resize'
  | 'gauge'
  | 'chip'
  | 'sun'
  | 'reset'
  | 'split'
  | 'merge'
  | 'sidebar'
  | 'lock'
  | 'unlock'

/**
 * An icon's drawing, up to three paths: the outline, the soft tint under its
 * main shape, and the solid marks (sparks, hearts, notes, dots).
 */
type Drawing = { stroke: string; fill?: string; marks?: string }

const roundRect = ({ x, y, w, h, r }: { x: number; y: number; w: number; h: number; r: number }) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}v-${h - 2 * r}a${r} ${r} 0 0 1 ${r} -${r}z`

const circle = ({ cx, cy, r }: { cx: number; cy: number; r: number }) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 -${2 * r} 0z`

/** A four-pointed spark, the mark inside the anime icons and the wand. */
const spark = ({ cx, cy, r }: { cx: number; cy: number; r: number }) =>
  `M${cx} ${cy - r}c${r * 0.15} ${r * 0.6} ${r * 0.4} ${r * 0.85} ${r} ${r}c-${r * 0.6} ${r * 0.15} -${r * 0.85} ${r * 0.4} -${r} ${r}c-${r * 0.15} -${r * 0.6} -${r * 0.4} -${r * 0.85} -${r} -${r}c${r * 0.6} -${r * 0.15} ${r * 0.85} -${r * 0.4} ${r} -${r}z`

const smallHeart = ({ cx, cy }: { cx: number; cy: number }) =>
  `M${cx} ${cy + 2.3}s-3-1.9-3-4a1.6 1.6 0 0 1 3-.9 1.6 1.6 0 0 1 3 .9c0 2.1-3 4-3 4z`

const smallPlay = ({ x, y, h }: { x: number; y: number; h: number }) =>
  `M${x} ${y + 0.5}v${h - 1}a.6.6 0 0 0 .9.5l${h * 0.8} -${h / 2 - 0.5}a.6.6 0 0 0 0-1l-${h * 0.8} -${h / 2 - 0.5}a.6.6 0 0 0 -.9.5z`

// The frames the film and TV icons share; each variant draws its mark inside one.
const FILM = `${roundRect({ x: 4, y: 3, w: 16, h: 18, r: 2.5 })}M8 3v18M16 3v18M6 6.5h.01M6 10h.01M6 14h.01M6 17.5h.01M18 6.5h.01M18 10h.01M18 14h.01M18 17.5h.01`
const FILM_FILL = 'M8 3h8v18H8z'
const TV_FILL = roundRect({ x: 3, y: 7.5, w: 18, h: 13, r: 2.5 })
const TV = `${TV_FILL}M8.5 3.5l3.5 4 3.5-4`
const HEART =
  'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z'
const PLAY = 'M8 5.6v12.8a1 1 0 0 0 1.5.9l10.2-6.4a1 1 0 0 0 0-1.8L9.5 4.7A1 1 0 0 0 8 5.6z'
const SPEAKER = 'M4.5 10a1 1 0 0 1 1-1h2.5l4-3.5v13L8 15H5.5a1 1 0 0 1-1-1z'
const LOCK_BODY = roundRect({ x: 5, y: 10.5, w: 14, h: 10, r: 2.5 })
const PANEL = roundRect({ x: 3.5, y: 4.5, w: 17, h: 15, r: 2.5 })
const SCREEN = roundRect({ x: 3, y: 5.5, w: 18, h: 13, r: 2.5 })
const BALL = circle({ cx: 12, cy: 12, r: 8.5 })
const BARS = `${roundRect({ x: 6.5, y: 5, w: 3.5, h: 14, r: 1.2 })}${roundRect({ x: 14, y: 5, w: 3.5, h: 14, r: 1.2 })}`
const DOUBLE_BACK = 'M11.5 7.5L6.5 12l5 4.5zM18.5 7.5l-5 4.5 5 4.5z'
const DOUBLE_ON = 'M12.5 7.5l5 4.5-5 4.5zM5.5 7.5l5 4.5-5 4.5z'
const HOUSE =
  'M4 10.6a2 2 0 0 1 .7-1.5l6-5.1a2 2 0 0 1 2.6 0l6 5.1a2 2 0 0 1 .7 1.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z'
const PAGE = 'M14 3.5H8a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.5z'
const BOOK =
  'M12 6.5C10 5 7 4.6 4.2 4.9a.8.8 0 0 0-.7.8v11.8a.8.8 0 0 0 .9.8c2.8-.3 5.6.1 7.6 1.6 2-1.5 4.8-1.9 7.6-1.6a.8.8 0 0 0 .9-.8V5.7a.8.8 0 0 0-.7-.8C17 4.6 14 5 12 6.5z'
const PAD =
  'M7.5 7h9a4.5 4.5 0 0 1 4.5 4.5v2.3a3.2 3.2 0 0 1-5.8 1.9L14.4 14.5H9.6l-.8 1.2A3.2 3.2 0 0 1 3 13.8v-2.3A4.5 4.5 0 0 1 7.5 7z'
const FOOTBALL =
  'M18.8 5.2c1.3 4.6-.1 9.4-3.6 12.1s-8.4 2.9-10 1.5c-1.3-4.6.1-9.4 3.6-12.1s8.4-2.9 10-1.5z'
const STOP = 'M8.6 3.5h6.8l5.1 5.1v6.8l-5.1 5.1H8.6l-5.1-5.1V8.6z'
const EARCUPS = `${roundRect({ x: 4, y: 14, w: 4, h: 6.5, r: 1.5 })}${roundRect({ x: 16, y: 14, w: 4, h: 6.5, r: 1.5 })}`

const DRAWINGS: Record<IconName, Drawing> = {
  home: {
    stroke:
      'M4 10.6a2 2 0 0 1 .7-1.5l6-5.1a2 2 0 0 1 2.6 0l6 5.1a2 2 0 0 1 .7 1.5V18a2 2 0 0 1-2 2h-3v-5a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v5H6a2 2 0 0 1-2-2z',
    fill: HOUSE,
  },
  libraries: {
    stroke: `${roundRect({ x: 3, y: 4, w: 4, h: 16, r: 1.2 })}${roundRect({ x: 9, y: 4, w: 4, h: 16, r: 1.2 })}M14.9 5.7l2.6-.7a1 1 0 0 1 1.2.7l3.2 12.6a1 1 0 0 1-.7 1.2l-2.6.7a1 1 0 0 1-1.2-.7L14.2 6.9a1 1 0 0 1 .7-1.2zM3 8h4M9 8h4`,
    fill: roundRect({ x: 9, y: 4, w: 4, h: 16, r: 1.2 }),
  },
  heart: { stroke: HEART, fill: HEART },
  settings: {
    stroke: `M4 7.5h8M18 7.5h2M4 16.5h2M12 16.5h8${circle({ cx: 15, cy: 7.5, r: 2.5 })}${circle({ cx: 9, cy: 16.5, r: 2.5 })}`,
    fill: `${circle({ cx: 15, cy: 7.5, r: 2.5 })}${circle({ cx: 9, cy: 16.5, r: 2.5 })}`,
  },
  sidebar: {
    stroke: `${PANEL}M9.5 4.5v15`,
    fill: 'M9.5 4.5H6a2.5 2.5 0 0 0-2.5 2.5v10A2.5 2.5 0 0 0 6 19.5h3.5z',
  },
  search: {
    stroke: `${circle({ cx: 11, cy: 11, r: 6.5 })}M16 16l4 4`,
    fill: circle({ cx: 11, cy: 11, r: 6.5 }),
  },
  back: { stroke: 'M14.5 6.5L9 12l5.5 5.5' },
  next: { stroke: 'M9.5 6.5L15 12l-5.5 5.5' },
  up: { stroke: 'M12 19V5.5M6 11l6-6 6 6' },
  download: { stroke: 'M12 4.5V15M7.5 10.5l4.5 4.5 4.5-4.5M5 19.5h14' },
  plus: { stroke: 'M12 5.5v13M5.5 12h13' },
  close: { stroke: 'M7 7l10 10M17 7L7 17' },
  check: { stroke: 'M5.5 12.5l4 4 9-9' },
  more: {
    stroke: '',
    marks: `${circle({ cx: 12, cy: 5.5, r: 1.4 })}${circle({ cx: 12, cy: 12, r: 1.4 })}${circle({ cx: 12, cy: 18.5, r: 1.4 })}`,
  },
  edit: { stroke: 'M14.5 5.5l4 4L9 19H5v-4zM12.5 7.5l4 4', fill: 'M14.5 5.5l4 4L9 19H5v-4z' },
  wand: {
    stroke: 'M4.5 19.5L14 10M12.5 8.5l3 3',
    marks: `${spark({ cx: 17.5, cy: 5.5, r: 2.5 })}${spark({ cx: 19.5, cy: 15.5, r: 1.8 })}${spark({ cx: 8.5, cy: 5, r: 1.5 })}`,
  },
  rescan: { stroke: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4' },
  reset: { stroke: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4' },
  history: {
    stroke: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4M12 8.5V12l2.5 1.5',
    fill: circle({ cx: 12, cy: 12, r: 7.5 }),
  },
  folder: {
    stroke:
      'M3.5 17V6.5a2 2 0 0 1 2-2h3.3a1.5 1.5 0 0 1 1.1.5l1.6 1.8h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM3.5 10h17',
    fill: 'M3.5 10h17V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z',
  },
  alert: {
    stroke:
      'M10.3 4.9a2 2 0 0 1 3.4 0l7 12.1a2 2 0 0 1-1.7 3h-14a2 2 0 0 1-1.7-3zM12 9.5v4M12 16.8v.2',
    fill: 'M10.3 4.9a2 2 0 0 1 3.4 0l7 12.1a2 2 0 0 1-1.7 3h-14a2 2 0 0 1-1.7-3z',
  },
  copy: {
    stroke: `${roundRect({ x: 8.5, y: 8.5, w: 11, h: 11, r: 2 })}M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2`,
    fill: roundRect({ x: 8.5, y: 8.5, w: 11, h: 11, r: 2 }),
  },
  trash: {
    stroke:
      'M4.5 7h15M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7M10 11v5M14 11v5',
    fill: 'M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7z',
  },
  pin: {
    stroke:
      'M9 4.5h6M10 4.5v5.2l-3.2 3.6a1 1 0 0 0-.3.7V15a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1a1 1 0 0 0-.3-.7L14 9.7V4.5M12 16v4.5',
    fill: 'M10 4.5v5.2l-3.2 3.6a1 1 0 0 0-.3.7V15a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1a1 1 0 0 0-.3-.7L14 9.7V4.5z',
  },
  lock: { stroke: `${LOCK_BODY}M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2`, fill: LOCK_BODY },
  unlock: { stroke: `${LOCK_BODY}M8 10.5V8a4 4 0 0 1 7.6-1.8M12 14.5v2`, fill: LOCK_BODY },
  image: {
    stroke: `${PANEL}M3.5 16l4.6-4.6a1.5 1.5 0 0 1 2.1 0L15 16.2M13.5 14.7l1.6-1.6a1.5 1.5 0 0 1 2.1 0l3.3 3.3`,
    fill: PANEL,
    marks: circle({ cx: 15.5, cy: 9, r: 1.5 }),
  },
  grid: {
    stroke: `${roundRect({ x: 4, y: 4, w: 6.5, h: 6.5, r: 1.5 })}${roundRect({ x: 13.5, y: 4, w: 6.5, h: 6.5, r: 1.5 })}${roundRect({ x: 4, y: 13.5, w: 6.5, h: 6.5, r: 1.5 })}${roundRect({ x: 13.5, y: 13.5, w: 6.5, h: 6.5, r: 1.5 })}`,
    fill: `${roundRect({ x: 4, y: 4, w: 6.5, h: 6.5, r: 1.5 })}${roundRect({ x: 13.5, y: 13.5, w: 6.5, h: 6.5, r: 1.5 })}`,
  },
  list: {
    stroke: 'M9.5 6.5h10M9.5 12h10M9.5 17.5h10',
    marks: `${circle({ cx: 5, cy: 6.5, r: 1.2 })}${circle({ cx: 5, cy: 12, r: 1.2 })}${circle({ cx: 5, cy: 17.5, r: 1.2 })}`,
  },
  tiles: {
    stroke: `${roundRect({ x: 3.5, y: 5, w: 7, h: 5, r: 1.5 })}${roundRect({ x: 3.5, y: 14, w: 7, h: 5, r: 1.5 })}M13.5 6.5h7M13.5 9h4.5M13.5 15.5h7M13.5 18h4.5`,
    fill: `${roundRect({ x: 3.5, y: 5, w: 7, h: 5, r: 1.5 })}${roundRect({ x: 3.5, y: 14, w: 7, h: 5, r: 1.5 })}`,
  },
  grouped: {
    stroke: `M4 4.5h7M4 15h7${roundRect({ x: 4, y: 7, w: 7, h: 5, r: 1.5 })}${roundRect({ x: 13, y: 7, w: 7, h: 5, r: 1.5 })}${roundRect({ x: 4, y: 17.5, w: 7, h: 3, r: 1 })}${roundRect({ x: 13, y: 17.5, w: 7, h: 3, r: 1 })}`,
    fill: `${roundRect({ x: 4, y: 7, w: 7, h: 5, r: 1.5 })}${roundRect({ x: 13, y: 7, w: 7, h: 5, r: 1.5 })}`,
  },
  ascending: { stroke: 'M7 19.5v-15M3.5 8L7 4.5 10.5 8M13.5 7h3M13.5 12h5M13.5 17h7' },
  descending: { stroke: 'M7 4.5v15M3.5 16L7 19.5l3.5-3.5M13.5 7h7M13.5 12h5M13.5 17h3' },
  convert: { stroke: 'M4.5 8.5h13M14.5 5.5l3 3-3 3M19.5 15.5h-13M9.5 12.5l-3 3 3 3' },
  resize: { stroke: 'M4.5 9.5v-5h5M4.5 4.5l6 6M19.5 14.5v5h-5M19.5 19.5l-6-6' },
  split: { stroke: 'M10 12H3.5M6.5 9l-3 3 3 3M14 12h6.5M17.5 9l3 3-3 3M12 5v14' },
  merge: {
    stroke:
      'M6.5 4l4.3 4.3a3 3 0 0 1 .9 2.1V20M17.5 4l-4.3 4.3a3 3 0 0 0-.7 1.1M8.5 16.5L12 20l3.5-3.5',
  },
  gauge: {
    stroke: 'M4.5 17a7.5 7.5 0 1 1 15 0M12 16.5l3.5-4.5M7.5 12.5l.9.5M12 8.5v1M16.5 12.5l-.2.1',
    fill: 'M4.5 17a7.5 7.5 0 1 1 15 0z',
    marks: circle({ cx: 12, cy: 16.5, r: 1.6 }),
  },
  chip: {
    stroke: `${roundRect({ x: 6.5, y: 6.5, w: 11, h: 11, r: 2 })}${roundRect({ x: 9.5, y: 9.5, w: 5, h: 5, r: 1 })}M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3`,
    fill: roundRect({ x: 9.5, y: 9.5, w: 5, h: 5, r: 1 }),
  },
  sun: {
    stroke: `${circle({ cx: 12, cy: 12, r: 3.8 })}M12 3v1.8M12 19.2V21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M3 12h1.8M19.2 12H21M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3`,
    fill: circle({ cx: 12, cy: 12, r: 3.8 }),
  },
  keyboard: {
    stroke: `${roundRect({ x: 3, y: 6, w: 18, h: 12, r: 2.5 })}M7 10h.01M10.3 10h.01M13.7 10h.01M17 10h.01M8 14h8`,
    fill: roundRect({ x: 3, y: 6, w: 18, h: 12, r: 2.5 }),
  },
  play: { stroke: PLAY, fill: PLAY },
  pause: { stroke: BARS, fill: BARS },
  rewind: { stroke: DOUBLE_BACK, fill: DOUBLE_BACK },
  forward: { stroke: DOUBLE_ON, fill: DOUBLE_ON },
  shuffle: {
    stroke:
      'M4 16.5h2.6a3 3 0 0 0 2.3-1.1l.6-.7M14.5 9.3l.6-.7a3 3 0 0 1 2.3-1.1H20M4 7.5h2.6a3 3 0 0 1 2.3 1.1l6.2 6.8a3 3 0 0 0 2.3 1.1H20M17.5 5l2.5 2.5-2.5 2.5M17.5 14l2.5 2.5-2.5 2.5',
  },
  volume: { stroke: `${SPEAKER}M15.5 9.5a3.5 3.5 0 0 1 0 5M18.3 7a7 7 0 0 1 0 10`, fill: SPEAKER },
  volumeLow: { stroke: `${SPEAKER}M15.5 9.5a3.5 3.5 0 0 1 0 5`, fill: SPEAKER },
  muted: { stroke: `${SPEAKER}M16 10l4 4M20 10l-4 4`, fill: SPEAKER },
  captions: {
    stroke: `${SCREEN}M10.5 10.2a2 2 0 1 0 0 3.6M16.5 10.2a2 2 0 1 0 0 3.6`,
    fill: SCREEN,
  },
  fullscreen: {
    stroke:
      'M4.5 9V6.5a2 2 0 0 1 2-2H9M15 4.5h2.5a2 2 0 0 1 2 2V9M19.5 15v2.5a2 2 0 0 1-2 2H15M9 19.5H6.5a2 2 0 0 1-2-2V15',
  },
  fullscreenExit: {
    stroke:
      'M9 4.5V7a2 2 0 0 1-2 2H4.5M15 4.5V7a2 2 0 0 0 2 2h2.5M15 19.5V17a2 2 0 0 1 2-2h2.5M9 19.5V17a2 2 0 0 0-2-2H4.5',
  },
  playback: {
    stroke: roundRect({ x: 3, y: 5, w: 18, h: 14, r: 2.5 }),
    fill: roundRect({ x: 3, y: 5, w: 18, h: 14, r: 2.5 }),
    marks: smallPlay({ x: 10, y: 9, h: 6 }),
  },
  'file-play': {
    stroke: `${PAGE}M14 3.5v4h4`,
    fill: PAGE,
    marks: smallPlay({ x: 10.3, y: 11, h: 5.4 }),
  },
  film: { stroke: FILM, fill: FILM_FILL },
  filmSpark: { stroke: FILM, fill: FILM_FILL, marks: spark({ cx: 12, cy: 12, r: 3 }) },
  filmHeart: { stroke: FILM, fill: FILM_FILL, marks: smallHeart({ cx: 12, cy: 12 }) },
  tv: { stroke: TV, fill: TV_FILL },
  tvSpark: { stroke: TV, fill: TV_FILL, marks: spark({ cx: 12, cy: 14, r: 3.2 }) },
  tvHeart: { stroke: TV, fill: TV_FILL, marks: smallHeart({ cx: 12, cy: 14 }) },
  tvGlobe: {
    stroke: `${TV}${circle({ cx: 12, cy: 14, r: 3.8 })}M8.2 14h7.6M12 10.2c-1 1-1.5 2.3-1.5 3.8s.5 2.8 1.5 3.8M12 10.2c1 1 1.5 2.3 1.5 3.8s-.5 2.8-1.5 3.8`,
    fill: TV_FILL,
  },
  musicVideo: {
    stroke: `${TV}M12.2 16.4V11l2.6 1`,
    fill: TV_FILL,
    marks: circle({ cx: 10.6, cy: 16.4, r: 1.6 }),
  },
  video: {
    stroke: `${roundRect({ x: 3, y: 6.5, w: 12.5, h: 11, r: 2.5 })}M15.5 10.5l4.6-2.8a.6.6 0 0 1 .9.5v7.6a.6.6 0 0 1-.9.5l-4.6-2.8`,
    fill: roundRect({ x: 3, y: 6.5, w: 12.5, h: 11, r: 2.5 }),
  },
  youtube: {
    stroke: roundRect({ x: 2.5, y: 5.5, w: 19, h: 13, r: 4 }),
    fill: roundRect({ x: 2.5, y: 5.5, w: 19, h: 13, r: 4 }),
    marks: smallPlay({ x: 10, y: 9, h: 6 }),
  },
  fourK: {
    stroke: `${SCREEN}M9.5 15V9l-3 4.2h4.2M13.5 9v6M17.3 9l-3.8 3.4M15 11.2l2.4 3.8`,
    fill: SCREEN,
  },
  globe: {
    stroke: `${BALL}M3.5 12h17M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5s-1.2 6.2-3.5 8.5M12 3.5c-2.3 2.3-3.5 5.2-3.5 8.5s1.2 6.2 3.5 8.5`,
    fill: BALL,
  },
  trophy: {
    stroke:
      'M7.5 4.5h9v4.5a4.5 4.5 0 0 1-9 0zM7.5 6.5h-2a.5.5 0 0 0-.5.5 3 3 0 0 0 2.6 3M16.5 6.5h2a.5.5 0 0 1 .5.5 3 3 0 0 1-2.6 3M12 13.5V17M8.5 20h7a.5.5 0 0 0 .5-.5 2.5 2.5 0 0 0-2.5-2.5h-3A2.5 2.5 0 0 0 8 19.5a.5.5 0 0 0 .5.5z',
    fill: 'M7.5 4.5h9v4.5a4.5 4.5 0 0 1-9 0z',
  },
  standUp: {
    stroke: `${roundRect({ x: 9, y: 2.5, w: 6, h: 9.5, r: 3 })}M6.5 10a5.5 5.5 0 0 0 11 0M12 15.5v5M8.5 20.5h7`,
    fill: roundRect({ x: 9, y: 2.5, w: 6, h: 9.5, r: 3 }),
  },
  gamepad: {
    stroke: `${PAD}M7.5 9.8v3.4M5.8 11.5h3.4`,
    fill: PAD,
    marks: `${circle({ cx: 15.5, cy: 10.6, r: 1 })}${circle({ cx: 17.6, cy: 12.6, r: 1 })}`,
  },
  octagon: {
    stroke: `${STOP}M10.3 7.5h3.4l2.8 2.8v3.4l-2.8 2.8h-3.4l-2.8-2.8v-3.4z`,
    fill: STOP,
  },
  basketball: {
    stroke: `${BALL}M3.5 12h17M12 3.5v17M6 6c1.8 1.6 2.8 3.7 2.8 6s-1 4.4-2.8 6M18 6c-1.8 1.6-2.8 3.7-2.8 6s1 4.4 2.8 6`,
    fill: BALL,
  },
  soccer: {
    stroke: `${BALL}M12 8V3.5M15.8 10.8l4.2-1.3M14.4 15.3l2.6 3.6M9.6 15.3L7 18.9M8.2 10.8L4 9.5`,
    fill: BALL,
    marks: 'M12 7.6l4.2 3-1.6 5H9.4l-1.6-5z',
  },
  americanFootball: {
    stroke: `${FOOTBALL}M9.5 14.5l5-5M10.8 11.6l1.6 1.6M12.4 10l1.6 1.6`,
    fill: FOOTBALL,
  },
  headphones: { stroke: `M4 15v-2.5a8 8 0 0 1 16 0V15${EARCUPS}`, fill: EARCUPS },
  music: {
    stroke: 'M9 17.5V6.3a1 1 0 0 1 .8-1l9-1.7a1 1 0 0 1 1.2 1v10.9M9 9.5l11-2',
    marks: `${circle({ cx: 6.5, cy: 17.5, r: 2.5 })}${circle({ cx: 17.5, cy: 15.5, r: 2.5 })}`,
  },
  disc: {
    stroke: `${BALL}${circle({ cx: 12, cy: 12, r: 2 })}M12 6.5a5.5 5.5 0 0 1 5.5 5.5`,
    fill: BALL,
  },
  podcast: {
    stroke: 'M8.5 13a5 5 0 1 1 7 0M6 15.5a8.5 8.5 0 1 1 12 0M12 13.5v7',
    marks: circle({ cx: 12, cy: 9.5, r: 2 }),
  },
  audiobook: { stroke: `${BOOK}M12 6.5v13`, fill: BOOK },
}

/** Arrows nudge their own way under the pointer instead of popping. */
const NUDGES: Partial<Record<IconName, string>> = {
  back: styles.nudgeBack,
  rewind: styles.nudgeBack,
  next: styles.nudgeOn,
  forward: styles.nudgeOn,
  convert: styles.nudgeOn,
  up: styles.nudgeUp,
  download: styles.nudgeDown,
}

const isIconName = (name: string): name is IconName => name in DRAWINGS

/** Every icon there is, for the design page. */
export const ICON_NAMES: readonly IconName[] = Object.keys(DRAWINGS).filter(isIconName)

/** How wide an icon is: pixels, or ems of the text it sits in, to grow and shrink with it. */
export type IconSize = number | `${number}em`

/**
 * Line icons with a soft tint under their main shape, which doubles while
 * the control around them is pointed at; a control marks itself current by
 * setting `--icon-tint`. Decorative by default: pair them with text or an
 * aria-label on the control.
 */
export const Icon = ({ name, size = 20 }: { name: IconName; size?: IconSize }) => {
  const { stroke, fill, marks } = DRAWINGS[name]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      className={`${styles.icon} ${NUDGES[name] ?? styles.pop}`}
    >
      {!!fill && <path className={styles.fill} d={fill} fill="currentColor" stroke="none" />}
      {!!stroke && <path d={stroke} />}
      {!!marks && <path className={styles.marks} d={marks} fill="currentColor" stroke="none" />}
    </svg>
  )
}
