import type { LibraryIconName } from '@raven/core'

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

// The frames the film and TV icons share; each variant draws its mark inside one.
const FILM = 'M4 3h16v18H4zM8 3v18M16 3v18M4 7.5h4M4 12h4M4 16.5h4M16 7.5h4M16 12h4M16 16.5h4'
const TV = 'M3 8h18v12H3zM8 3.5l4 4.5 4-4.5'

const PATHS: Record<IconName, string> = {
  back: 'M15 18l-6-6 6-6',
  plus: 'M12 5v14M5 12h14',
  rescan: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  wand: 'M4 20l10-10M14 10l1.5-1.5M17 3v2M17 9v2M14 6h2M20 6h2M19 15v2M19 21v2M16 18h2M22 18h2',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  up: 'M12 19V5M5 12l7-7 7 7',
  alert: 'M12 4l9 16H3L12 4zM12 10v4M12 17.5v.5',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  more: 'M12 5.5v.5M12 12v.5M12 18.5v.5',
  heart: 'M12 21s-8-5.3-8-11a4.5 4.5 0 0 1 8-2.8 4.5 4.5 0 0 1 8 2.8c0 5.7-8 11-8 11z',
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M8 5v14M16 5v14',
  rewind: 'M11 7l-5 5 5 5M18 7l-5 5 5 5',
  forward: 'M13 7l5 5-5 5M6 7l5 5-5 5',
  volume: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10',
  volumeLow: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9.5a3.5 3.5 0 0 1 0 5',
  muted: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4zM16 9.5l5 5M21 9.5l-5 5',
  captions:
    'M4 5.5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM10.5 10a2 2 0 1 0 0 4M17 10a2 2 0 1 0 0 4',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  fullscreenExit: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  keyboard: 'M3 6.5h18v11H3zM7 10.5h.01M11 10.5h.01M15 10.5h.01M8 14h8',
  pin: 'M12 17v5M9 4h6M10 4v6l-4 4v3h12v-3l-4-4V4',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  tiles: 'M3 5h7v5H3zM13 6h8M13 9h5M3 14h7v5H3zM13 15h8M13 18h5',
  grouped: 'M4 4h7M4 7h7v5H4zM13 7h7v5h-7zM4 15h7M4 18h7v2H4zM13 18h7v2h-7z',
  shuffle: 'M4 7h3l10 10h3M4 17h3l3-3M14 10l3-3h3M18 4l3 3-3 3M18 14l3 3-3 3',
  history: 'M4 11a8 8 0 1 1 2.3 5.7M4 5v6h6M12 8v4l3 2',
  next: 'M9 6l6 6-6 6',
  film: FILM,
  filmSpark: `${FILM}M12 8.6L12.8 11.2 14.4 12 12.8 12.8 12 15.4 11.2 12.8 9.6 12 11.2 11.2z`,
  tv: TV,
  tvSpark: `${TV}M12 10.5L13 13 15.5 14 13 15 12 17.5 11 15 8.5 14 11 13z`,
  filmHeart: `${FILM}M12 14.6s-2.6-1.7-2.6-3.6a1.5 1.5 0 0 1 2.6-.9 1.5 1.5 0 0 1 2.6.9c0 1.9-2.6 3.6-2.6 3.6z`,
  tvHeart: `${TV}M12 16.6s-2.6-1.7-2.6-3.6a1.5 1.5 0 0 1 2.6-.9 1.5 1.5 0 0 1 2.6.9c0 1.9-2.6 3.6-2.6 3.6z`,
  globe:
    'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9M12 3c-2.5 2.5-3.8 5.5-3.8 9s1.3 6.5 3.8 9',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M14 9a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0',
  ascending: 'M7 20V4M3 8l4-4 4 4M13 7h3M13 12h5M13 17h7',
  descending: 'M7 4v16M3 16l4 4 4-4M13 7h7M13 12h5M13 17h3',
  trophy: 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v6M8 20h8',
  youtube:
    'M6 5.5h12a3.5 3.5 0 0 1 3.5 3.5v6a3.5 3.5 0 0 1-3.5 3.5H6A3.5 3.5 0 0 1 2.5 15V9A3.5 3.5 0 0 1 6 5.5zM10 9.5v5l4.5-2.5z',
  video: 'M3 7h12v10H3zM15 10.5l6-3.5v10l-6-3.5',
  tvGlobe: `${TV}M12 10a4 4 0 1 0 0 8 4 4 0 1 0 0-8zM8 14h8M12 10c-1.1 1.1-1.6 2.5-1.6 4s.5 2.9 1.6 4M12 10c1.1 1.1 1.6 2.5 1.6 4s-.5 2.9-1.6 4`,
  fourK: 'M3 6h18v12H3zM9.5 15V9l-3 4.5h4.5M13.5 9v6M17.5 9l-4 3.5M15 11.2l2.5 3.8',
  musicVideo: `${TV}M13 16.2v-5.4l2.4 1M13 16.2a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z`,
  standUp: 'M12 2.5a3 3 0 0 0-3 3v3a3 3 0 0 0 6 0v-3a3 3 0 0 0-3-3zM9 7h6M12 11.5V21M8 21h8',
  gamepad:
    'M7.5 7.5h9a4.5 4.5 0 0 1 4.5 4.5v1.5a3.5 3.5 0 0 1-6.3 2.1L14 14.5h-4l-.7 1.1A3.5 3.5 0 0 1 3 13.5V12a4.5 4.5 0 0 1 4.5-4.5zM7.5 10.5v3M6 12h3M15.5 11.5h.01M17.5 13h.01',
  octagon:
    'M8.4 3.2h7.2l5.2 5.2v7.2l-5.2 5.2H8.4l-5.2-5.2V8.4zM10 7.2h4l2.8 2.8v4L14 16.8h-4L7.2 14v-4z',
  basketball:
    'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM3 12h18M12 3v18M5.6 5.7C7.6 7.4 8.6 9.6 8.6 12s-1 4.6-3 6.3M18.4 5.7c-2 1.7-3 3.9-3 6.3s1 4.6 3 6.3',
  soccer:
    'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 7.5l4.3 3.1-1.6 5h-5.4l-1.6-5zM12 7.5V3M16.3 10.6l4.3-1.4M14.7 15.6l2.6 3.7M9.3 15.6l-2.6 3.7M7.7 10.6L3.4 9.2',
  americanFootball:
    'M5 19C3.5 14 5 8.5 9 5.5S16.5 3 19 5c1.5 5 0 10.5-4 13.5S7.5 20.5 5 19zM9.5 14.5l5-5M11 11.5l1.5 1.5M12.5 10l1.5 1.5M9.5 13l1.5 1.5',
  headphones: 'M4 14a8 8 0 0 1 16 0M4 14h3.5v6.5H4zM16.5 14H20v6.5h-3.5z',
  music:
    'M9 18V5.5l11-2V16M9 9.5l11-2M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  disc: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 10a2 2 0 1 0 0 4 2 2 0 1 0 0-4zM12 6.5a5.5 5.5 0 0 1 5.5 5.5',
  podcast:
    'M12 7.5a2 2 0 1 0 0 4 2 2 0 1 0 0-4zM8.5 13a5 5 0 1 1 7 0M6 15.5a8.5 8.5 0 1 1 12 0M12 14.5v6',
  audiobook:
    'M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5c-3.5-.5-6.5 0-8.5 1.5zM12 6.5v13',
  libraries: 'M3 4h4v16H3zM9 4h4v16H9zM14.6 5l3.6-1 3.4 15-3.6 1z',
  home: 'M3 11.5L12 4l9 7.5M5.5 9.5V20h5v-5.5h3V20h5V9.5',
  playback: 'M3 5h18v14H3zM10 9v6l5-3z',
  'file-play': 'M6 3h8l4 4v14H6zM14 3v4h4M10.5 11v6l4.5-3z',
  convert: 'M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3',
  resize: 'M4 9V4h5M4 4l6 6M20 15v5h-5M20 20l-6-6',
  gauge: 'M4 17a8 8 0 1 1 16 0M12 17l4-5M7.5 12.5l1 .6',
  chip: 'M7 7h10v10H7zM10 10h4v4h-4zM9.5 3v4M14.5 3v4M9.5 17v4M14.5 17v4M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4',
  reset: 'M4 11a8 8 0 1 1 2.3 5.7M4 5v6h6',
  split: 'M10 12H3M7 8l-4 4 4 4M14 12h7M17 8l4 4-4 4',
  merge: 'M6 3l6 6v12M18 3l-6 6M8 17l4 4 4-4',
  sidebar: 'M4 5h16v14H4zM9.5 5v14',
  lock: 'M5 11h14v10H5zM8 11V7.5a4 4 0 0 1 8 0V11M12 15v2',
  unlock: 'M5 11h14v10H5zM8 11V7.5a4 4 0 0 1 7.7-1.5M12 15v2',
}

const isIconName = (name: string): name is IconName => name in PATHS

/** Every icon there is, for the design page. */
export const ICON_NAMES: readonly IconName[] = Object.keys(PATHS).filter(isIconName)

/** How wide an icon is: pixels, or ems of the text it sits in, to grow and shrink with it. */
export type IconSize = number | `${number}em`

/** Line icons. Decorative by default: pair them with text or an aria-label on the control. */
export const Icon = ({ name, size = 20 }: { name: IconName; size?: IconSize }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    data-icon={name}
  >
    <path d={PATHS[name]} />
  </svg>
)
