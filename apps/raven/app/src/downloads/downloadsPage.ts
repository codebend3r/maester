import {
  type LibraryIconName,
  QUEUE_SOURCE_KINDS,
  type SpeedSample,
  type Track,
  durationLabelOf,
  formatBytes,
  freshSpeed,
  secondsLeftOf,
  speedLabelOf,
  totalSpeed,
} from '@raven/core'
import type { DownloadReading } from '@raven/native/headless'

import { DOWNLOAD_COPY } from '@/downloads/copy'
import {
  DOWNLOAD_KINDS,
  DOWNLOAD_STATES,
  type DownloadEntry,
  type DownloadGroup,
  type DownloadLibrary,
  GROUP_KINDS,
  type UnderwayEntry,
  type UnderwayStatus,
  bytesOf,
  groupKeyOfEntry,
  isDone,
  isFailed,
  isQueued,
  isUnderway,
  keyOfEntry,
  libraryOfEntry,
  usedBytesOf,
} from '@/downloads/downloadEntries'
import { underwayTextOf } from '@/downloads/downloadStatusText'
import { type Entries, visibleEntriesOf } from '@/downloads/downloadVisibility'

type Readings = Readonly<Record<string, DownloadReading>>

type Samples = Readonly<Record<string, SpeedSample>>

/** Where a row of the Underway list stands: coming in or waiting its turn, or failed. */
export const UNDERWAY_PHASES = { coming: 'coming', failed: 'failed' } as const

export type UnderwayPhase = (typeof UNDERWAY_PHASES)[keyof typeof UNDERWAY_PHASES]

/** A download on its way, or one that failed, as Downloads lists it. */
export type UnderwayRow = {
  key: string
  title: string
  line: string
  /** "Queued", "Preparing on server 42%", "42%", or why it failed. */
  status: string
  /** "1.2 GB of 4.0 GB" once bytes come; null before. */
  bytes: string | null
  /** From 0 to 1 for the bar; null while there is nothing to measure. */
  fraction: number | null
  /** "12.4 MB/s"; null while quiet. */
  speed: string | null
  /** "finished in 36m" at the current speed; null while quiet or its size is unknown. */
  timeLeft: string | null
  /** The show's or movie's name, which stands in for its title art. */
  name: string
  /** Its title art saved on the device, as a path under the documents; null for none yet. */
  logoPath: string | null
  /** Its poster or cover saved on the device, as a path under the documents; null for none yet. */
  artPath: string | null
  /** A track's square cover, not a poster. */
  isMusic: boolean
  phase: UnderwayPhase
  /** Waiting its turn, so it may be dragged to another place in the line. */
  isQueued: boolean
}

/** A finished download, as its group lists it. */
export type FinishedRow = {
  key: string
  title: string
  line: string
  size: string
  kind: DownloadEntry['kind']
  mediaId: number
}

/** What a finished group holds: videos the player opens, or music the queue plays. */
export const FINISHED_KINDS = { video: 'video', music: 'music' } as const

/** What the music queue says a group's tracks play from: the album or the playlist. */
type MusicSource = {
  kind: typeof QUEUE_SOURCE_KINDS.album | typeof QUEUE_SOURCE_KINDS.playlist
  id: number
}

/** The queue source each music group plays from. */
const MUSIC_SOURCE_KINDS = {
  [GROUP_KINDS.album]: QUEUE_SOURCE_KINDS.album,
  [GROUP_KINDS.playlist]: QUEUE_SOURCE_KINDS.playlist,
} as const

type FinishedGroupBase = {
  key: string
  title: string
  /** "3 episodes · 4.2 GB". */
  line: string
  /** The picture saved beside its first file, as a path under the documents; null for none. */
  artPath: string | null
  /** The show's or movie's name, which stands in for its title art. */
  name: string
  /** Its title art saved beside a file, as a path under the documents; null for none. */
  logoPath: string | null
  /** "Season 1" under a show's name; null for anything else. */
  season: string | null
  rows: FinishedRow[]
}

/** A show's season, a movie, an album or a playlist, as Downloads shows what of it is finished. */
export type FinishedGroup =
  | (FinishedGroupBase & { kind: typeof FINISHED_KINDS.video })
  | (FinishedGroupBase & {
      kind: typeof FINISHED_KINDS.music
      /** Its finished tracks in order, for Play. */
      tracks: Track[]
      source: MusicSource
    })

/** The finished downloads of one library, for Downloads shown by library. */
export type LibrarySection = {
  key: string
  name: string
  /** The library's icon; null for the section of downloads whose library is unknown. */
  icon: LibraryIconName | null
  groups: FinishedGroup[]
}

export type DownloadsPage = {
  /** "123.4 GB available"; null where the device cannot say. */
  available: string | null
  /** "Downloads use 4.2 GB", hidden downloads counted too. */
  used: string
  /** Every running download's speed added up; null while none is moving. */
  speed: string | null
  /** The one downloading or preparing first, then the queue in its order, then those that failed. */
  underway: UnderwayRow[]
  finished: FinishedGroup[]
  /** The same groups under their libraries, by name, those with no library last under "Other". */
  finishedByLibrary: LibrarySection[]
}

const LIBRARY_KEY_PREFIX = 'library:'

const OTHER_LIBRARY_KEY = 'other'

type GroupedEntries = { group: FinishedGroup; entries: readonly DownloadEntry[] }

const byName = (a: LibrarySection, b: LibrarySection): number => a.name.localeCompare(b.name)

/** The library a group's downloads were filed under; null when none was recorded. */
const libraryOfGroup = ({ entries }: GroupedEntries): DownloadLibrary | null =>
  entries[0] === undefined ? null : libraryOfEntry(entries[0])

/** The section a group's library puts it under, as it starts, with no groups yet. */
const sectionOf = (library: DownloadLibrary | null): LibrarySection => ({
  key: library === null ? OTHER_LIBRARY_KEY : `${LIBRARY_KEY_PREFIX}${library.id}`,
  name: library?.name ?? DOWNLOAD_COPY.otherLibrary,
  icon: library?.icon ?? null,
  groups: [],
})

/** The finished groups under their libraries, sorted by name, with "Other" for the library-less last. */
const sectionsOf = (grouped: readonly GroupedEntries[]): LibrarySection[] => {
  // The map is the reduce's own, so adding to it in place shares nothing.
  const byKey = grouped.reduce((sections, item) => {
    const fresh = sectionOf(libraryOfGroup(item))
    const section = sections.get(fresh.key) ?? fresh
    return sections.set(section.key, { ...section, groups: [...section.groups, item.group] })
  }, new Map<string, LibrarySection>())
  const sections = [...byKey.values()]
  const named = sections.filter(({ key }) => key !== OTHER_LIBRARY_KEY).toSorted(byName)
  const other = sections.filter(({ key }) => key === OTHER_LIBRARY_KEY)
  return [...named, ...other]
}

/** The order the Underway list runs in: what is coming in, then the queue; what failed follows. */
const UNDERWAY_RANKS = {
  [DOWNLOAD_STATES.preparing]: 0,
  [DOWNLOAD_STATES.downloading]: 0,
  [DOWNLOAD_STATES.queued]: 1,
} as const satisfies Record<UnderwayStatus['state'], number>

const byRankThenPlace = (a: UnderwayEntry, b: UnderwayEntry): number =>
  UNDERWAY_RANKS[a.status.state] - UNDERWAY_RANKS[b.status.state] || a.place - b.place

const byPlace = (a: DownloadEntry, b: DownloadEntry): number => a.place - b.place

/** What every row of the Underway list says of its download, whatever its state. */
const rowBaseOf = (entry: DownloadEntry) => ({
  key: keyOfEntry(entry),
  title: entry.title,
  line: entry.line,
  bytes: null,
  speed: null,
  timeLeft: null,
  name: entry.group.title,
  logoPath: entry.logoPath ?? null,
  artPath: entry.artPath,
  isMusic: entry.kind === DOWNLOAD_KINDS.track,
  isQueued: isQueued(entry),
})

type FailedRowOfProps = { entry: DownloadEntry; message: string }

const failedRowOf = ({ entry, message }: FailedRowOfProps): UnderwayRow => ({
  ...rowBaseOf(entry),
  status: message,
  fraction: null,
  phase: UNDERWAY_PHASES.failed,
})

type UnderwayRowOfProps = {
  entry: UnderwayEntry
  readings: Readings
  samples: Samples
  now: number
}

const underwayRowOf = ({ entry, readings, samples, now }: UnderwayRowOfProps): UnderwayRow => {
  const key = keyOfEntry(entry)
  const reading = readings[key]
  const { status } = entry
  const common = {
    ...rowBaseOf(entry),
    status: underwayTextOf({ status, reading }),
    phase: UNDERWAY_PHASES.coming,
  }
  if (status.state === DOWNLOAD_STATES.preparing) return { ...common, fraction: status.progress }
  if (status.state !== DOWNLOAD_STATES.downloading || reading === undefined) {
    return { ...common, fraction: null }
  }
  const bytesPerSecond = freshSpeed({ sample: samples[key], now })
  const secondsLeft =
    reading.total > 0
      ? secondsLeftOf({ remaining: reading.total - reading.bytes, bytesPerSecond })
      : null
  return {
    ...common,
    bytes: DOWNLOAD_COPY.progress({ done: reading.bytes, total: reading.total }),
    fraction: reading.total > 0 ? Math.min(1, reading.bytes / reading.total) : null,
    speed: speedLabelOf(bytesPerSecond),
    timeLeft: secondsLeft === null ? null : DOWNLOAD_COPY.finishedIn(durationLabelOf(secondsLeft)),
  }
}

const byOrder = (a: DownloadEntry, b: DownloadEntry): number => a.order - b.order

/** What the music queue plays a group from, for an album or a playlist; null for videos. */
const musicSourceOf = ({ kind, id }: DownloadGroup): MusicSource | null =>
  kind === GROUP_KINDS.album || kind === GROUP_KINDS.playlist
    ? { kind: MUSIC_SOURCE_KINDS[kind], id }
    : null

const groupOf = (entries: readonly DownloadEntry[]): FinishedGroup | null => {
  const sorted = entries.toSorted(byOrder)
  const [first] = sorted
  if (first === undefined) return null
  const { group } = first
  const source = musicSourceOf(group)
  const isSingle = group.kind === GROUP_KINDS.movie || group.kind === GROUP_KINDS.video
  const size = formatBytes(usedBytesOf(sorted))
  const count =
    source === null ? DOWNLOAD_COPY.episodes(sorted.length) : DOWNLOAD_COPY.tracks(sorted.length)
  const base: FinishedGroupBase = {
    key: groupKeyOfEntry(first),
    title:
      group.season === null
        ? group.title
        : DOWNLOAD_COPY.season({ title: group.title, season: group.season }),
    line: isSingle ? size : [count, size].join(DOWNLOAD_COPY.separator),
    artPath: sorted.find(({ artPath }) => artPath !== null)?.artPath ?? null,
    name: group.title,
    logoPath: sorted.find(({ logoPath }) => !!logoPath)?.logoPath ?? null,
    season: group.season === null ? null : DOWNLOAD_COPY.seasonNumber(group.season),
    rows: sorted.map((entry) => ({
      key: keyOfEntry(entry),
      title: entry.title,
      line: entry.line,
      size: formatBytes(bytesOf(entry)),
      kind: entry.kind,
      mediaId: entry.mediaId,
    })),
  }
  if (source === null) return { ...base, kind: FINISHED_KINDS.video }
  return {
    ...base,
    kind: FINISHED_KINDS.music,
    tracks: sorted.flatMap((entry) => (entry.kind === DOWNLOAD_KINDS.track ? [entry.track] : [])),
    source,
  }
}

/** When the newest of a group was asked for. */
const latest = (group: readonly DownloadEntry[]): number =>
  Math.max(...group.map(({ addedAt }) => addedAt))

type DownloadsPageOfProps = {
  entries: Entries
  serverId: string
  /** Whether this device holds the server's PIN unlock; without it a locked library's downloads are left out. */
  isUnlocked: boolean
  readings: Readings
  samples: Samples
  now: number
  freeBytes: number | null
}

/**
 * What Downloads shows for `serverId`: the space left and the space the downloads take, the
 * total speed, those on their way (or failed) oldest first, then the finished ones grouped by
 * show and season, movie, album or playlist, most recently asked for first.
 */
export const downloadsPageOf = ({
  entries,
  serverId,
  isUnlocked,
  readings,
  samples,
  now,
  freeBytes,
}: DownloadsPageOfProps): DownloadsPage => {
  const mine = Object.values(entries).filter((entry) => entry.serverId === serverId)
  const visible = Object.values(visibleEntriesOf({ entries, isUnlocked })).filter(
    (entry) => entry.serverId === serverId,
  )
  const underway = visible.filter(isUnderway).toSorted(byRankThenPlace)
  const failed = visible.filter(isFailed).toSorted(byPlace)
  const done = visible.filter(isDone)
  // The map is the reduce's own, so adding to it in place shares nothing.
  const byGroup = done.reduce((groups, entry) => {
    const key = groupKeyOfEntry(entry)
    return groups.set(key, [...(groups.get(key) ?? []), entry])
  }, new Map<string, DownloadEntry[]>())
  const grouped = [...byGroup.values()]
    .toSorted((a, b) => latest(b) - latest(a))
    .flatMap((group): GroupedEntries[] => {
      const finished = groupOf(group)
      return finished === null ? [] : [{ group: finished, entries: group }]
    })
  return {
    available: freeBytes === null ? null : DOWNLOAD_COPY.available(freeBytes),
    used: DOWNLOAD_COPY.used(usedBytesOf(mine)),
    speed: speedLabelOf(
      totalSpeed({
        samples: underway.flatMap((entry) => {
          const sample = samples[keyOfEntry(entry)]
          return sample === undefined ? [] : [sample]
        }),
        now,
      }),
    ),
    underway: [
      ...underway.map((entry) => underwayRowOf({ entry, readings, samples, now })),
      ...failed.map((entry) => failedRowOf({ entry, message: entry.status.message })),
    ],
    finished: grouped.map(({ group }) => group),
    finishedByLibrary: sectionsOf(grouped),
  }
}
