import { PLAYED_KINDS, type PlayHistoryEntry, type Played } from '@/contract'
import { episodeCode } from '@/items'

/** How far through counts as finished: the default watched percentage. */
export const FINISHED_AT = 0.95

export const REACH_KINDS = { unknown: 'unknown', finished: 'finished', partial: 'partial' } as const

/**
 * How far one sitting got: unknown for a listen kept from before the
 * history, finished past `FINISHED_AT` of a known length, else the spot it
 * reached and, when the length is known, its share of it.
 */
export type Reach =
  | { kind: typeof REACH_KINDS.unknown }
  | { kind: typeof REACH_KINDS.finished }
  | {
      kind: typeof REACH_KINDS.partial
      furthest: number
      duration: number | null
      percent: number | null
    }

type ReachOfProps = Pick<PlayHistoryEntry, 'furthest' | 'duration'>

export const reachOf = ({ furthest, duration }: ReachOfProps): Reach => {
  if (furthest === null) return { kind: REACH_KINDS.unknown }
  if (duration === null || duration <= 0) {
    return { kind: REACH_KINDS.partial, furthest, duration: null, percent: null }
  }
  if (furthest >= duration * FINISHED_AT) return { kind: REACH_KINDS.finished }
  return {
    kind: REACH_KINDS.partial,
    furthest,
    duration,
    percent: Math.floor((furthest / duration) * 100),
  }
}

const CONTEXT_SEPARATOR = ' · '

/** What a played file belongs to: "Severance · S01E02", "Radiohead · OK Computer"; null for a film or a clip. */
export const playedContext = (played: Played): string | null => {
  switch (played.kind) {
    case PLAYED_KINDS.episode:
      return [played.show, episodeCode(played)]
        .filter((part) => part !== null)
        .join(CONTEXT_SEPARATOR)
    case PLAYED_KINDS.track:
      return [played.artist, played.album].filter((part) => part !== null).join(CONTEXT_SEPARATOR)
    case PLAYED_KINDS.video:
      return played.year === null ? null : String(played.year)
    default: {
      const unreachable: never = played
      return unreachable
    }
  }
}

export const HISTORY_ROW_KINDS = { entry: 'entry', album: 'album' } as const

/** A run of one account's tracks off one album, back to back: how many played, and whether that was all of it. */
export type AlbumRun = {
  key: string
  album: string
  artist: string | null
  /** How many of the album's tracks the run heard at least once. */
  tracksHeard: number
  albumTracks: number
  /** Every track of the album was heard in the run. */
  isWhole: boolean
}

/** A history as a table shows it: each entry, under a heading for each run of an album's tracks. */
export type HistoryRow =
  | { kind: typeof HISTORY_ROW_KINDS.entry; key: string; entry: PlayHistoryEntry }
  | { kind: typeof HISTORY_ROW_KINDS.album; key: string; run: AlbumRun }

type TrackOf = Extract<Played, { kind: typeof PLAYED_KINDS.track }>

const trackOf = (entry: PlayHistoryEntry): TrackOf | null =>
  entry.played.kind === PLAYED_KINDS.track ? entry.played : null

const entryKey = (entry: PlayHistoryEntry): string => `${entry.accountId}:${entry.id}`

type Run = { albumId: number | null; accountId: string; entries: PlayHistoryEntry[] }

type ContinuesProps = { run: Run | undefined; entry: PlayHistoryEntry }

/** Whether `entry` carries on the run before it: the same account, off the same album. */
const continues = ({ run, entry }: ContinuesProps): boolean => {
  const track = trackOf(entry)
  return (
    !!run && track !== null && run.albumId === track.albumId && run.accountId === entry.accountId
  )
}

const runsOf = (entries: readonly PlayHistoryEntry[]): Run[] =>
  entries.reduce<Run[]>((runs, entry) => {
    const last = runs.at(-1)
    if (last && continues({ run: last, entry })) {
      return runs.with(runs.length - 1, { ...last, entries: last.entries.concat(entry) })
    }
    return runs.concat({
      albumId: trackOf(entry)?.albumId ?? null,
      accountId: entry.accountId,
      entries: [entry],
    })
  }, [])

const albumRunOf = (entries: readonly PlayHistoryEntry[]): AlbumRun | null => {
  const tracks = entries.flatMap((entry) => trackOf(entry) ?? [])
  const [first] = tracks
  const [newest] = entries
  if (!first || !newest || tracks.length < 2) return null
  const tracksHeard = new Set(tracks.map(({ disc, number, title }) => `${disc}:${number ?? title}`))
    .size
  return {
    key: `album:${entryKey(newest)}`,
    album: first.album,
    artist: first.artist,
    tracksHeard,
    albumTracks: first.albumTracks,
    isWhole: first.albumTracks > 0 && tracksHeard >= first.albumTracks,
  }
}

/**
 * The rows a history table shows, in the entries' order: two or more of an
 * account's tracks off one album, back to back, sit under a heading for the
 * album that says how much of it they heard. A run broken by anything else
 * starts again after it, and a run is grouped only within what has loaded.
 */
export const historyRows = (entries: readonly PlayHistoryEntry[]): HistoryRow[] =>
  runsOf(entries).flatMap((run): HistoryRow[] => {
    const rows = run.entries.map((entry): HistoryRow => ({
      kind: HISTORY_ROW_KINDS.entry,
      key: entryKey(entry),
      entry,
    }))
    const album = albumRunOf(run.entries)
    return album ? [{ kind: HISTORY_ROW_KINDS.album, key: album.key, run: album }, ...rows] : rows
  })
