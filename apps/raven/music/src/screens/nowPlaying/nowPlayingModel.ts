import {
  type Queue,
  type QueueSource,
  QUEUE_SOURCE_KINDS,
  type Track,
  artistNames,
  formatDuration,
  orderedOf,
} from '@raven/core'

import { NOW_PLAYING_COPY } from '@/screens/copy'
import { FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'

/** What Now Playing shows under its header: the player, the lyrics, or what plays next. */
export const PANES = { player: 'player', lyrics: 'lyrics', upNext: 'upNext' } as const

export type Pane = (typeof PANES)[keyof typeof PANES]

type PaneAfterProps = { current: Pane; pressed: Pane }

/** The pane a press on the bottom bar leaves showing: the one pressed, or the player again when it was already open. */
export const paneAfter = ({ current, pressed }: PaneAfterProps): Pane =>
  pressed === current ? PANES.player : pressed

/** A song still to play, as Up next lists it. */
export type UpNextRow = {
  key: string
  /** Where it sits in the play order, which a jump, a move or a remove names. */
  place: number
  track: Track
  /** "Sia · 3:36". */
  line: string
  /** How a screen reader names it: "Chandelier, Sia". */
  label: string
}

type UpNextRowsOfProps = { queue: Queue; tracks: Readonly<Record<number, Track>> }

/** The songs after the one playing, in play order, keyed by their place so a repeat is its own row. */
export const upNextRowsOf = ({ queue, tracks }: UpNextRowsOfProps): UpNextRow[] =>
  orderedOf(queue).flatMap(({ id }, place) => {
    const track = tracks[id]
    if (track === undefined || (queue.at !== null && place <= queue.at)) return []
    const artists = artistNames(track)
    return [
      {
        key: `${id}:${place}`,
        place,
        track,
        line: NOW_PLAYING_COPY.rowLine({ artists, length: formatDuration(track.duration) }),
        label: NOW_PLAYING_COPY.entry({ title: track.title, line: artists }),
      },
    ]
  })

type DropPlaceOfProps = {
  place: number
  /** How far the row was dragged, in points, down positive. */
  shift: number
  rowHeight: number
  /** The first and last places a row may land on: the songs after the one playing. */
  first: number
  last: number
}

/** Where a dragged row lands: as many places as whole rows it moved past, inside the list. */
export const dropPlaceOf = ({ place, shift, rowHeight, first, last }: DropPlaceOfProps): number =>
  Math.min(last, Math.max(first, place + Math.round(shift / rowHeight)))

/** What a song is played on, as `Platform.OS` names it. */
const PLATFORMS = { android: 'android' } as const

type DeviceOfProps = { os: string; formFactor: FormFactor }

const APPLE_DEVICES = {
  [FORM_FACTORS.phone]: NOW_PLAYING_COPY.devices.iPhone,
  [FORM_FACTORS.tablet]: NOW_PLAYING_COPY.devices.iPad,
} as const satisfies Record<FormFactor, string>

/** The word for the device Wren plays on: iPhone, iPad or Android. */
export const deviceOf = ({ os, formFactor }: DeviceOfProps): string =>
  os === PLATFORMS.android ? NOW_PLAYING_COPY.devices.android : APPLE_DEVICES[formFactor]

/** Where the queue started, as the header names it: an overline and a name. */
export type SourceTitle = {
  overline: string
  name: string
  /** The source's name for Up next's line, or null when the queue has none to name. */
  sourceName: string | null
}

type SourceTitleOfProps = {
  source: QueueSource | null
  track: Track
  /** The playlist's or the artist's name once read, null until then. */
  playlistName: string | null
  artistName: string | null
}

/**
 * What the header says the queue plays from: the album, the playlist or the artist it was
 * started from, by name, or the playing song's album when it names none of them.
 */
export const sourceTitleOf = ({
  source,
  track,
  playlistName,
  artistName,
}: SourceTitleOfProps): SourceTitle => {
  const album = track.album.title
  const kind = source?.kind ?? null
  if (kind === QUEUE_SOURCE_KINDS.playlist && playlistName !== null) {
    return {
      overline: NOW_PLAYING_COPY.from.playlist,
      name: playlistName,
      sourceName: playlistName,
    }
  }
  if (kind === QUEUE_SOURCE_KINDS.artist && artistName !== null) {
    return { overline: NOW_PLAYING_COPY.from.artist, name: artistName, sourceName: artistName }
  }
  if (kind === QUEUE_SOURCE_KINDS.album) {
    return { overline: NOW_PLAYING_COPY.from.album, name: album, sourceName: album }
  }
  return { overline: NOW_PLAYING_COPY.from.other, name: album, sourceName: null }
}

/** How a synced line is drawn: already sung, being sung, or still to come. */
export const LYRIC_TONES = { sung: 'sung', current: 'current', upcoming: 'upcoming' } as const

export type LyricTone = (typeof LYRIC_TONES)[keyof typeof LYRIC_TONES]

type LyricToneOfProps = { place: number; current: number | null }

/** A line's tone by where it is against the one being sung; all are to come before the first. */
export const lyricToneOf = ({ place, current }: LyricToneOfProps): LyricTone => {
  if (current === null || place > current) return LYRIC_TONES.upcoming
  return place === current ? LYRIC_TONES.current : LYRIC_TONES.sung
}

// The share of the lyrics' height above the line being sung.
const LYRIC_ANCHOR = 1 / 3

type LyricOffsetOfProps = { lineTop: number; viewport: number }

/** Where the lyrics scroll to keep the line being sung about a third of the way down. */
export const lyricOffsetOf = ({ lineTop, viewport }: LyricOffsetOfProps): number =>
  Math.max(0, lineTop - viewport * LYRIC_ANCHOR)

/** The places Clear removes, last first, so each removal leaves the next one's place as it was. */
export const placesToClearOf = (rows: readonly UpNextRow[]): number[] =>
  rows.map(({ place }) => place).toSorted((a, b) => b - a)
