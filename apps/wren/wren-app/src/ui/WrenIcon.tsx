import Svg, { Path } from 'react-native-svg'

import { SIZE } from '@/theme/wrenTokens'

/** How a drawing takes its colour: a line traced in it, or a shape filled with it. */
const INKS = { stroke: 'stroke', fill: 'fill' } as const

type Ink = (typeof INKS)[keyof typeof INKS]

/** A drawing: its ink and its shapes, each as SVG path data. */
type Drawing = { ink: Ink; shapes: readonly string[] }

type CircleProps = { cx: number; cy: number; r: number }

/** A circle as path data: two half arcs from its left edge. */
const circle = ({ cx, cy, r }: CircleProps): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`

type RectProps = { x: number; y: number; width: number; height: number; rx: number }

/** A rounded rectangle as path data, clockwise from its top left corner. */
const rect = ({ x, y, width, height, rx }: RectProps): string =>
  [
    `M${x + rx} ${y}H${x + width - rx}`,
    `A${rx} ${rx} 0 0 1 ${x + width} ${y + rx}V${y + height - rx}`,
    `A${rx} ${rx} 0 0 1 ${x + width - rx} ${y + height}H${x + rx}`,
    `A${rx} ${rx} 0 0 1 ${x} ${y + height - rx}V${y + rx}`,
    `A${rx} ${rx} 0 0 1 ${x + rx} ${y}Z`,
  ].join('')

const lines = (...shapes: readonly string[]): Drawing => ({ ink: INKS.stroke, shapes })

const solid = (...shapes: readonly string[]): Drawing => ({ ink: INKS.fill, shapes })

const HEART =
  'M12 19.8s-7.2-4.4-9-9.3C1.8 7.2 4 4.4 7 4.4c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3 0 5.2 2.8 4 6.1-1.8 4.9-9 9.3-9 9.3z'

const REPEAT =
  'm17 3 3 3-3 3M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20M7 21l-3-3 3-3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4'

const EYE = 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z'

const RING = circle({ cx: 12, cy: 12, r: 8.5 })

/**
 * Wren's line icons, from the redesign handoff's reference pages: a 24 point box, lines 1.75
 * wide with round ends and joins. Play, pause, next, previous, more and the filled heart are
 * solid shapes.
 */
export const ICONS = {
  home: lines(
    'M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-5.8H9.2v5.8H5A1.5 1.5 0 0 1 3.5 19z',
  ),
  library: lines('M5 4v16M9.5 4v16M14 4.8l5.2 15'),
  search: lines(circle({ cx: 11, cy: 11, r: 6.8 }), 'm20 20-4.2-4.2'),
  settings: lines(
    'M4 6.5h9M18 6.5h2M4 12h3M11 12h9M4 17.5h11M19 17.5h1',
    circle({ cx: 15.5, cy: 6.5, r: 2.2 }),
    circle({ cx: 8.8, cy: 12, r: 2.2 }),
    circle({ cx: 17, cy: 17.5, r: 2.2 }),
  ),
  back: lines('m14.5 5-7 7 7 7'),
  chevronRight: lines('m9.5 5 7 7-7 7'),
  chevronDown: lines('m5 9 7 7 7-7'),
  close: lines('M6.5 6.5l11 11M17.5 6.5l-11 11'),
  more: solid(
    circle({ cx: 5.5, cy: 12, r: 1.7 }),
    circle({ cx: 12, cy: 12, r: 1.7 }),
    circle({ cx: 18.5, cy: 12, r: 1.7 }),
  ),
  play: solid('M7.5 4.8v14.4a.8.8 0 0 0 1.2.7l11.6-7.2a.8.8 0 0 0 0-1.4L8.7 4.1a.8.8 0 0 0-1.2.7z'),
  pause: solid(
    rect({ x: 6, y: 4.5, width: 4.2, height: 15, rx: 1.2 }),
    rect({ x: 13.8, y: 4.5, width: 4.2, height: 15, rx: 1.2 }),
  ),
  next: solid(
    'M5 5.6v12.8a.8.8 0 0 0 1.2.7l9.4-6.4a.8.8 0 0 0 0-1.4L6.2 4.9a.8.8 0 0 0-1.2.7z',
    rect({ x: 17, y: 4.5, width: 2.6, height: 15, rx: 1.1 }),
  ),
  previous: solid(
    'M19 5.6v12.8a.8.8 0 0 1-1.2.7l-9.4-6.4a.8.8 0 0 1 0-1.4l9.4-6.4a.8.8 0 0 1 1.2.7z',
    rect({ x: 4.4, y: 4.5, width: 2.6, height: 15, rx: 1.1 }),
  ),
  shuffle: lines(
    'M3 7h3c2.6 0 4 1.6 5.6 5s3 5 5.6 5H21M18 14l3 3-3 3M3 17h3c1.3 0 2.3-.4 3.1-1.1M14.4 8.1c.8-.7 1.7-1.1 2.9-1.1H21M18 4l3 3-3 3',
  ),
  repeat: lines(REPEAT),
  repeatOne: lines(REPEAT, 'M11.2 10.6 12.4 10v4.2'),
  heart: lines(HEART),
  heartFilled: solid(HEART),
  download: lines('M12 4v11M7.5 10.8 12 15.3l4.5-4.5M5 19.5h14'),
  downloads: lines(RING, 'M12 7.8v7.6M8.9 12.4 12 15.5l3.1-3.1'),
  downloaded: lines(RING, 'm8.3 12.3 2.5 2.5 4.9-5'),
  check: lines('m5 12.5 4.5 4.5L19 7.5'),
  plus: lines('M12 5v14M5 12h14'),
  queueAdd: lines('M4 6h13M4 11h13M4 16h7M18 13.5v7M14.5 17h7'),
  playNext: lines('M4 6h10M4 11h10M4 16h6', 'M17 9v9M13.8 14.8 17 18l3.2-3.2'),
  playlistAdd: lines(rect({ x: 3.5, y: 3.5, width: 17, height: 17, rx: 4 }), 'M12 8.5v7M8.5 12h7'),
  playlist: lines(
    'M4 6h12M4 11h12M4 16h7',
    circle({ cx: 16, cy: 17, r: 2.4 }),
    'M18.4 17V8.5l2.3-.6',
  ),
  artist: lines(
    circle({ cx: 12, cy: 8.3, r: 3.8 }),
    'M4.8 20c1.1-3.6 4-5.3 7.2-5.3s6.1 1.7 7.2 5.3',
  ),
  album: lines(RING, circle({ cx: 12, cy: 12, r: 2.4 })),
  song: lines(
    'M9 17.5V5.5l10-2v12',
    circle({ cx: 6.5, cy: 17.5, r: 2.5 }),
    circle({ cx: 16.5, cy: 15.5, r: 2.5 }),
  ),
  image: lines(
    rect({ x: 3.5, y: 4.5, width: 17, height: 15, rx: 3 }),
    circle({ cx: 9, cy: 10, r: 1.6 }),
    'm4 17 5-4.5 4 3.5 3-2.5 4 3',
  ),
  lyrics: lines('M4.5 5.5h15v10.5H10l-5.5 4z', 'M8.5 9.5h7M8.5 12.5h4.5'),
  upNext: lines('M4 6h13M4 11h13M4 16h7', 'M15 14.2v6.2l5-3.1z'),
  output: lines(
    rect({ x: 6, y: 3, width: 12, height: 18, rx: 3 }),
    circle({ cx: 12, cy: 14.2, r: 2.8 }),
    'M12 7.2h.01',
  ),
  mail: lines(rect({ x: 3.5, y: 5.5, width: 17, height: 13, rx: 2.5 }), 'm4.5 7 7.5 6 7.5-6'),
  lock: lines(
    rect({ x: 5, y: 10.5, width: 14, height: 10, rx: 2.5 }),
    'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5',
  ),
  eye: lines(EYE, circle({ cx: 12, cy: 12, r: 2.8 })),
  eyeOff: lines(EYE, circle({ cx: 12, cy: 12, r: 2.8 }), 'M4 4l16 16'),
  alert: lines(RING, 'M12 7.8v5M12 16.2h.01'),
  info: lines(RING, 'M12 11v5.2M12 7.8h.01'),
  recent: lines(RING, 'M12 7.5V12l3 2'),
  server: lines(
    rect({ x: 3.5, y: 4, width: 17, height: 7, rx: 2 }),
    rect({ x: 3.5, y: 13, width: 17, height: 7, rx: 2 }),
    'M7.5 7.5h.01M7.5 16.5h.01',
  ),
  storage: lines(rect({ x: 3.5, y: 6, width: 17, height: 12, rx: 2.5 }), 'M7 14.5h4M16.5 14.5h.01'),
  quality: lines('M5 19v-3M9.5 19v-6M14 19v-9M18.5 19V5'),
  trash: lines('M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12.5h9.2L17.5 7'),
  dragHandle: lines('M5 9.5h14M5 14.5h14'),
  sort: lines('M7 4.5v15M4 16.5l3 3 3-3M17 19.5v-15M14 7.5l3-3 3 3'),
  grid: lines(
    rect({ x: 3.5, y: 3.5, width: 7, height: 7, rx: 1.5 }),
    rect({ x: 13.5, y: 3.5, width: 7, height: 7, rx: 1.5 }),
    rect({ x: 3.5, y: 13.5, width: 7, height: 7, rx: 1.5 }),
    rect({ x: 13.5, y: 13.5, width: 7, height: 7, rx: 1.5 }),
  ),
} as const satisfies Record<string, Drawing>

/** One of `ICONS`: what a control hands `WrenIcon`, `ICONS.play`. */
export type WrenIconName = (typeof ICONS)[keyof typeof ICONS]

type WrenIconProps = {
  name: WrenIconName
  size?: number
  color: string
  /** A line icon's width; the active tab's is drawn at 2. */
  strokeWidth?: number
}

type InkPropsOf = { color: string; strokeWidth: number }

/** How each kind of drawing takes its colour. */
const INK_PROPS = {
  [INKS.stroke]: ({ color, strokeWidth }: InkPropsOf) => ({
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }),
  [INKS.fill]: ({ color }: InkPropsOf) => ({ fill: color }),
} as const satisfies Record<Ink, (props: InkPropsOf) => object>

/**
 * One of Wren's icons. It is decorative: the control it sits in carries the label, so a
 * screen reader never stops on the drawing itself.
 */
export function WrenIcon({
  name,
  size = SIZE.icon,
  color,
  strokeWidth = SIZE.stroke,
}: WrenIconProps) {
  const { ink, shapes } = name
  return (
    <Svg
      accessibilityElementsHidden
      height={size}
      importantForAccessibility="no-hide-descendants"
      viewBox="0 0 24 24"
      width={size}
      {...INK_PROPS[ink]({ color, strokeWidth })}
    >
      {shapes.map((shape) => (
        <Path d={shape} key={shape} />
      ))}
    </Svg>
  )
}
