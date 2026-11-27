import {
  FINISHED_AT,
  type Infer,
  type Track,
  isNumber,
  isRecord,
  isString,
  nullable,
  object,
  wholeNumberIn,
} from '@raven/core'

import { FINISHED_SHOWN } from '@/library/libraryCounts'

/** The key the songs' progress is stored under on the device. */
export const SONG_PROGRESS_KEY = 'wren.songProgress'

/** How many songs the device remembers, the most recently played first; the oldest go past it. */
export const SONG_PROGRESS_KEPT = 1000

/** How far into a song its spot is saved again while it plays, in seconds. */
export const SONG_SAVE_EVERY_S = 10

/** How far into a song it counts as begun, in seconds, unless 5% of it comes first. */
const BEGUN_AFTER_S = 5

/** How much of a song counts as begun when that comes before `BEGUN_AFTER_S`. */
const BEGUN_SHARE = 0.05

/** Where a song was left partway: seconds in, and when, as an ISO time. */
const isLeftSpot = object({ position: isNumber, at: isString })

/**
 * One song as this device remembers it: which server's track it is, the album and library it
 * belongs to (so a list reads its album's page and keeps to the library worn), where it was left
 * while it is partway, and when it last played to its end. A song replayed partway after it
 * finished is both.
 */
const isSongProgress = object({
  serverId: isString,
  trackId: wholeNumberIn({ min: 0 }),
  albumId: wholeNumberIn({ min: 0 }),
  libraryId: wholeNumberIn({ min: 0 }),
  /** Where it was left, while it is partway; null when it is not. */
  left: nullable(isLeftSpot),
  /** When it last played to its end, as an ISO time; null when it never has here. */
  finishedAt: nullable(isString),
})

export type SongProgress = Infer<typeof isSongProgress>

/** What a moment of a song's play means for its progress. */
export const SONG_NOTES = {
  notBegun: 'notBegun',
  partway: 'partway',
  finished: 'finished',
} as const

/** A song not yet begun, left partway at a spot, or played to its end. */
export type SongNote =
  | { kind: typeof SONG_NOTES.notBegun }
  | { kind: typeof SONG_NOTES.partway; position: number }
  | { kind: typeof SONG_NOTES.finished }

type SongNoteOfProps = { position: number; duration: number | null }

/**
 * What a song `position` seconds in means: played to its end past `FINISHED_AT` of its length,
 * as a listen counts, not begun in its first seconds (5, or 5% of a short song), which are a
 * misclick rather than a place to come back to, and partway between.
 */
export const songNoteOf = ({ position, duration }: SongNoteOfProps): SongNote => {
  if (duration !== null && duration > 0 && position >= duration * FINISHED_AT) {
    return { kind: SONG_NOTES.finished }
  }
  const begunAt = Math.min(BEGUN_AFTER_S, (duration ?? Number.POSITIVE_INFINITY) * BEGUN_SHARE)
  if (position < begunAt) return { kind: SONG_NOTES.notBegun }
  return { kind: SONG_NOTES.partway, position }
}

type IsSongSaveDueProps = { lastSaved: number; position: number }

/** Whether a playing song has moved `SONG_SAVE_EVERY_S` from the spot last saved, either way. */
export const isSongSaveDue = ({ lastSaved, position }: IsSongSaveDueProps): boolean =>
  Math.abs(position - lastSaved) >= SONG_SAVE_EVERY_S

/** The least of a track a song's keeper reads: which it is, and how long. */
type HeardTrack = Pick<Track, 'id' | 'duration'>

/** What a song's keeper last heard of the playing song, and what it last saved of it. */
export type HeardSong<T extends HeardTrack> = {
  track: T
  position: number
  lastSaved: number
  isPlaying: boolean
  /** Whether it was noted played to its end, so its end is noted once a play. */
  isFinished: boolean
}

/** A spot of a song to note. */
export type SongSave<T extends HeardTrack> = { track: T; position: number }

type SongStepOfProps<T extends HeardTrack> = {
  heard: HeardSong<T> | null
  /** What plays now, if anything. */
  track: T | null
  position: number
  isPlaying: boolean
}

type SongStep<T extends HeardTrack> = { heard: HeardSong<T> | null; saves: SongSave<T>[] }

/** The spot a song was left at, unless it was noted played to its end. */
export const songLeftOf = <T extends HeardTrack>(heard: HeardSong<T> | null): SongSave<T>[] =>
  heard === null || heard.isFinished ? [] : [{ track: heard.track, position: heard.position }]

type PlayingStepOfProps<T extends HeardTrack> = {
  heard: HeardSong<T>
  position: number
  isPlaying: boolean
}

/** One moment of the same song: its end noted once, else its spot on a pause and every save step. */
const playingStepOf = <T extends HeardTrack>({
  heard,
  position,
  isPlaying,
}: PlayingStepOfProps<T>): SongStep<T> => {
  const isAtEnd =
    songNoteOf({ position, duration: heard.track.duration }).kind === SONG_NOTES.finished
  const moved = { ...heard, position, isPlaying, isFinished: heard.isFinished && isAtEnd }
  if (isAtEnd && !heard.isFinished) {
    return {
      heard: { ...moved, lastSaved: position, isFinished: true },
      saves: [{ track: heard.track, position }],
    }
  }
  const isPaused = heard.isPlaying && !isPlaying
  const isDue = isPaused || (isPlaying && isSongSaveDue({ lastSaved: heard.lastSaved, position }))
  if (!isDue || moved.isFinished) return { heard: moved, saves: [] }
  return { heard: { ...moved, lastSaved: position }, saves: [{ track: heard.track, position }] }
}

/**
 * What a moment of the queue means for the songs' progress: what to note, and what to remember
 * of the song playing. A song another takes over from, or the queue empties under, is noted
 * where it was left; the one playing is noted once at its end, and partway as it pauses and
 * every `SONG_SAVE_EVERY_S` of play, so a page or an app closed without a pause loses little.
 */
export const songStepOf = <T extends HeardTrack>({
  heard,
  track,
  position,
  isPlaying,
}: SongStepOfProps<T>): SongStep<T> => {
  const isSame = heard !== null && track !== null && heard.track.id === track.id
  if (heard !== null && isSame) return playingStepOf({ heard, position, isPlaying })
  const saves = songLeftOf(heard)
  if (track === null) return { heard: null, saves }
  return {
    heard: { track, position, lastSaved: position, isPlaying, isFinished: false },
    saves,
  }
}

type SongRef = { serverId: string; trackId: number }

const isSong =
  ({ serverId, trackId }: SongRef) =>
  (song: SongProgress): boolean =>
    song.serverId === serverId && song.trackId === trackId

/** When a song last played here: the later of when it was left and when it finished. */
const lastPlayedOf = ({ left, finishedAt }: SongProgress): string =>
  [left?.at ?? '', finishedAt ?? ''].toSorted().at(-1) ?? ''

/** The newest first, so the songs past `SONG_PROGRESS_KEPT` are the ones least recently played. */
const newestFirst = (a: SongProgress, b: SongProgress): number =>
  lastPlayedOf(b).localeCompare(lastPlayedOf(a))

type WithSongNoteProps = {
  songs: readonly SongProgress[]
  serverId: string
  track: Pick<Track, 'id' | 'albumId' | 'libraryId'>
  note: SongNote
  /** When it was noted, as an ISO time. */
  at: string
}

/**
 * The songs with one noted: a song left partway keeps its spot and when, and stays finished if
 * it was; one played to its end is finished now and partway no more; one not yet begun leaves
 * the songs as they were. The newest is first, and at most `SONG_PROGRESS_KEPT` are kept.
 */
export const withSongNote = ({
  songs,
  serverId,
  track,
  note,
  at,
}: WithSongNoteProps): SongProgress[] => {
  if (note.kind === SONG_NOTES.notBegun) return [...songs]
  const same = isSong({ serverId, trackId: track.id })
  const earlier = songs.find(same)
  const base = {
    serverId,
    trackId: track.id,
    albumId: track.albumId,
    libraryId: track.libraryId,
    finishedAt: earlier?.finishedAt ?? null,
  }
  const noted: SongProgress =
    note.kind === SONG_NOTES.partway
      ? { ...base, left: { position: note.position, at } }
      : { ...base, left: null, finishedAt: at }
  return [noted, ...songs.filter((song) => !same(song))]
    .toSorted(newestFirst)
    .slice(0, SONG_PROGRESS_KEPT)
}

/** What was read back: every entry that is a song's progress, the rest dropped. */
export const songProgressOf = (saved: unknown): SongProgress[] => {
  const entries = isRecord(saved) && Array.isArray(saved.songs) ? saved.songs : []
  return entries.filter(isSongProgress).toSorted(newestFirst).slice(0, SONG_PROGRESS_KEPT)
}

type MergedSongProgressOfProps = {
  /** What was noted since the device started, before what it kept was read back. */
  current: readonly SongProgress[]
  /** What was read back, unchecked. */
  saved: unknown
}

/** The songs read back with those noted meanwhile, which stand over the same song read back. */
export const mergedSongProgressOf = ({
  current,
  saved,
}: MergedSongProgressOfProps): SongProgress[] =>
  [
    ...current,
    ...songProgressOf(saved).filter(
      (song) => !current.some(isSong({ serverId: song.serverId, trackId: song.trackId })),
    ),
  ]
    .toSorted(newestFirst)
    .slice(0, SONG_PROGRESS_KEPT)

type SongsOfProps = {
  songs: readonly SongProgress[]
  serverId: string
  /** The music libraries worn; a song of any other is left out. */
  libraryIds: readonly number[]
}

const shownOf = ({ songs, serverId, libraryIds }: SongsOfProps): SongProgress[] =>
  songs.filter((song) => song.serverId === serverId && libraryIds.includes(song.libraryId))

/** A song with the time it is listed by: when it was left, or when it finished. */
type Dated = { song: SongProgress; at: string }

const byNewest = (a: Dated, b: Dated): number => b.at.localeCompare(a.at)

const datedLeftOf = (props: SongsOfProps): Dated[] =>
  shownOf(props).flatMap((song) => (song.left === null ? [] : [{ song, at: song.left.at }]))

const datedFinishedOf = (props: SongsOfProps): Dated[] =>
  shownOf(props).flatMap((song) =>
    song.finishedAt === null ? [] : [{ song, at: song.finishedAt }],
  )

/** The songs left partway through on this device, the most recently left first. */
export const inProgressSongsOf = (props: SongsOfProps): SongProgress[] =>
  datedLeftOf(props)
    .toSorted(byNewest)
    .map(({ song }) => song)

/** The songs played to their end on this device, the newest first, as many as Recently finished shows. */
export const finishedSongsOf = (props: SongsOfProps): SongProgress[] =>
  datedFinishedOf(props)
    .toSorted(byNewest)
    .slice(0, FINISHED_SHOWN)
    .map(({ song }) => song)

/** How many songs are partway and how many finished on this device, every one counted. */
export const songCountsOf = (props: SongsOfProps) => ({
  inProgress: datedLeftOf(props).length,
  finished: datedFinishedOf(props).length,
})

/** The albums a list of songs needs read to play them as tracks, each once, in the order first met. */
export const songAlbumIdsOf = (songs: readonly SongProgress[]): number[] => [
  ...new Set(songs.map(({ albumId }) => albumId)),
]

type ResumeAtOfProps = { songs: readonly SongProgress[] } & SongRef

/** Where a song left partway on this device starts again; null for one that is not. */
export const resumeAtOf = ({ songs, serverId, trackId }: ResumeAtOfProps): number | null =>
  songs.find(isSong({ serverId, trackId }))?.left?.position ?? null
