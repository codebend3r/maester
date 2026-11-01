import type { Track } from '@raven/core'
import { shuffle } from '@/media/shuffle'

/** The calendar day `now` falls on, in UTC, as `YYYY-MM-DD`: the same for every viewer and every server zone. */
export const utcDayOf = (now: number): string => new Date(now).toISOString().slice(0, 10)

type DayShuffleProps<T> = { items: readonly T[]; now: number; key: string }

/**
 * `items` in an order fixed by the UTC day and `key` (a mix's kind, a radio's
 * seed), so the same day deals the same order and the next day another.
 */
export const dayShuffle = <T>({ items, now, key }: DayShuffleProps<T>): T[] => {
  // FNV-1a over the day and the key: a cheap, stable number to seed the shuffle with.
  const seed = [...`${utcDayOf(now)}:${key}`].reduce(
    (hash, char) => Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16_777_619) >>> 0,
    2_166_136_261,
  )
  return shuffle({ items, seed })
}

/** The artist a track is filed under for spacing: its first credited, or none. */
const leadOf = (track: Track): number | null => track.artists[0]?.id ?? null

type CountsProps = { tracks: readonly Track[] }

const countsOf = ({ tracks }: CountsProps): Map<number | null, number> =>
  tracks.reduce(
    (counts, track) => counts.set(leadOf(track), (counts.get(leadOf(track)) ?? 0) + 1),
    new Map<number | null, number>(),
  )

type CanFollowProps = { rest: readonly Track[]; last: number | null }

/**
 * Whether `rest` can still be laid out with no artist twice in a row after
 * one by `last`: no artist holds more than every other place, and `last`
 * not even that, since it cannot go first.
 */
const canFollow = ({ rest, last }: CanFollowProps): boolean =>
  [...countsOf({ tracks: rest })].every(([lead, count]) =>
    lead === last ? count <= Math.floor(rest.length / 2) : count <= Math.ceil(rest.length / 2),
  )

type InterleavedProps = { tracks: readonly Track[] }

/**
 * The tracks in nearly the order given, but with no artist twice in a row
 * where that can be avoided: each place takes the earliest track by another
 * artist than the last that still leaves the rest a way to alternate, else
 * the earliest by another artist, else the earliest.
 */
export const interleaved = ({ tracks }: InterleavedProps): Track[] =>
  tracks.reduce<{ placed: Track[]; rest: Track[] }>(
    ({ placed, rest }) => {
      const previous = placed.at(-1)
      const last = previous === undefined ? undefined : leadOf(previous)
      const isOther = (track: Track): boolean => last === undefined || leadOf(track) !== last
      const without = (at: number): Track[] => rest.filter((_, index) => index !== at)
      const spaced = rest.findIndex(
        (track, at) => isOther(track) && canFollow({ rest: without(at), last: leadOf(track) }),
      )
      const other = rest.findIndex(isOther)
      const at = [spaced, other, 0].find((index) => index >= 0) ?? 0
      const next = rest[at]
      return next === undefined
        ? { placed, rest }
        : { placed: [...placed, next], rest: without(at) }
    },
    { placed: [], rest: [...tracks] },
  ).placed
