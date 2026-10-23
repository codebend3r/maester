import { type JumpScale, LETTERS } from '@raven/core'

/**
 * How tall a touch strip's mark stands, in points. The most is the web's: each step a 27th
 * (the alphabet's share) of at most 40rem. The least is what a finger can still press.
 */
export const JUMP_MARK_HEIGHTS = { least: 20, most: (40 * 16) / LETTERS.length } as const

/** One mark the strip draws: one of the scale's, or neighbouring ones gathered into it. */
export type StripMark = {
  key: string
  label: string
  name: string
  /** The cards under it; null for a mark no card is under, which cannot be pressed. */
  keys: ReadonlySet<string> | null
}

const own = (scale: JumpScale): StripMark[] =>
  scale.marks.map(({ key, label, name }) => ({
    key,
    label,
    name,
    keys: scale.entries.get(key) ?? null,
  }))

/**
 * Runs of `size` neighbouring marks, each drawn as its first and jumping to the first card under
 * any.
 */
const gathered = ({ scale, size }: { scale: JumpScale; size: number }): StripMark[] =>
  Array.from({ length: Math.ceil(scale.marks.length / size) }, (_, at) => {
    const run = scale.marks.slice(at * size, (at + 1) * size)
    const [first] = run
    const last = run.at(-1)
    if (first === undefined || last === undefined) throw new Error('A jump run with no marks')
    const keys = run.flatMap((mark) => Array.from(scale.entries.get(mark.key) ?? []))
    return {
      key: first.key,
      label: first.label,
      name: first === last ? first.name : `${first.name} to ${last.name}`,
      keys: keys.length === 0 ? null : new Set(keys),
    }
  })

/**
 * The marks a strip of `room` points draws, and how tall each stands. As on the web each takes
 * the alphabet's share of the room, at most the web's cap; where that is under what a finger
 * can press, or under `labelHeight`, its label's at the viewer's text size, each takes that
 * least instead, and where even then they do not all fit, as on a phone held sideways,
 * neighbouring marks are gathered into one, which the web never needs.
 */
export const fitJumpMarks = ({
  scale,
  room,
  labelHeight,
}: {
  scale: JumpScale
  room: number
  labelHeight: number
}): { height: number; marks: StripMark[] } => {
  const least = Math.max(JUMP_MARK_HEIGHTS.least, labelHeight)
  const most = Math.max(JUMP_MARK_HEIGHTS.most, least)
  const share = Math.min(most, room / LETTERS.length)
  if (share >= least) return { height: share, marks: own(scale) }
  if (scale.marks.length * least <= room) return { height: least, marks: own(scale) }
  const fits = Math.max(1, Math.floor(room / least))
  const marks = gathered({ scale, size: Math.ceil(scale.marks.length / fits) })
  return { height: Math.min(most, room / marks.length), marks }
}
