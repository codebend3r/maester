import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import {
  DEFAULT_OUTPUT_SETTINGS,
  DOWNLOAD_GROUP_PREFIXES,
  DOWNLOAD_KINDS,
  DOWNLOAD_STATUS_KINDS,
  type DownloadGroup,
  downloadGroupKey,
  type Track,
} from '@raven/core'
import { CLIP_SECONDS } from '@/e2e/clips'
import { containerOf } from '@/e2e/fixtureServer'
import { NO_SERVER } from '@/e2e/harness'
import { CONFIG_FILE, DEFAULT_UPDATE_SETTINGS, type DesktopConfig } from '@/main/desktopConfig'
import {
  type DownloadEntry,
  DOWNLOADS_FILE,
  DOWNLOADS_VERSION,
  type DownloadsState,
  isDownloadsState,
  NO_PENDING,
} from '@/main/downloads/downloadState'
import { entryDirFor, mediaPathFor } from '@/main/downloads/space'

const MINUTE_MS = 60_000
// Every seeded download was confirmed an hour before the launch that finds it.
const SEEDED_AGO_MS = 60 * MINUTE_MS
// The share of a title that counts as watched, the server's own default.
const WATCHED_PERCENT = 90

/** A clip to file as a ready download, as main would have left it once its bytes were in. */
type SeededClip = {
  /** The file copied in as the download's video. */
  path: string
  /** The download's title: its row's name on Downloads and the player's heading. */
  label: string
  mediaId: number
  /** Where it sits among the downloads; a movie of its own when left out. */
  group?: DownloadGroup
  shouldAutoDelete?: boolean
  /** When it was watched to its end, in milliseconds since the epoch; never, when left out. */
  watchedAt?: number
  /** A track's `Track`, which Downloads queues it by in the music queue; none for a video. */
  track?: Track
}

type SeedDownloadsProps = {
  userData: string
  clips: readonly SeededClip[]
  /** The server the config names; the one a launch without a fixture points at when left out. */
  origin?: string
}

type EpisodeGroupProps = { showId: number; title: string; episode: number }

/** An episode's place in the first season of a show, so its group plays in episode order. */
export const episodeGroup = ({ showId, title, episode }: EpisodeGroupProps): DownloadGroup => ({
  kind: DOWNLOAD_KINDS.show,
  key: downloadGroupKey({ prefix: DOWNLOAD_GROUP_PREFIXES.show, ids: [showId] }),
  title,
  order: 10_000 + episode,
})

type MovieGroupProps = Pick<SeededClip, 'mediaId' | 'label'>

const movieGroup = ({ mediaId, label }: MovieGroupProps): DownloadGroup => ({
  kind: DOWNLOAD_KINDS.movie,
  key: downloadGroupKey({ prefix: DOWNLOAD_GROUP_PREFIXES.movie, ids: [mediaId] }),
  title: label,
  order: 0,
})

type EntryOfProps = { clip: SeededClip; serverId: string; at: number }

const entryOf = async ({ clip, serverId, at }: EntryOfProps): Promise<DownloadEntry> => {
  const { path, label, mediaId } = clip
  return {
    downloadId: randomUUID(),
    serverId,
    mediaId,
    label,
    group: clip.group ?? movieGroup({ mediaId, label }),
    container: containerOf(path),
    size: (await stat(path)).size,
    duration: CLIP_SECONDS,
    watchedPercent: WATCHED_PERCENT,
    sidecars: [],
    status: { kind: DOWNLOAD_STATUS_KINDS.ready },
    autoDelete: clip.shouldAutoDelete ?? false,
    watchedAt: clip.watchedAt ?? null,
    serverPosition: 0,
    pending: NO_PENDING,
    createdAt: at - SEEDED_AGO_MS,
    ...(clip.track === undefined ? {} : { track: clip.track }),
  }
}

type PlaceProps = { userData: string; entry: DownloadEntry; path: string }

/** Copies a clip to where main keeps that download's video. */
const place = async ({ userData, entry, path }: PlaceProps): Promise<void> => {
  const { serverId, mediaId, container } = entry
  await mkdir(entryDirFor({ userData, serverId, mediaId }), { recursive: true })
  await copyFile(path, mediaPathFor({ userData, serverId, mediaId, container }))
}

/** Where the seeded downloads were filed: the id of the server they belong to. */
type SeededDownloads = { serverId: string }

/**
 * Files `clips` as ready downloads in a profile no launch has used yet: the config naming their
 * server, `downloads.json` and each video where main looks for it, so the next launch lists and
 * plays them with no server. Answers the id they are filed under.
 */
export const seedDownloads = async ({
  userData,
  clips,
  origin = NO_SERVER,
}: SeedDownloadsProps): Promise<SeededDownloads> => {
  const serverId = randomUUID()
  const at = Date.now()
  const config: DesktopConfig = {
    version: 5,
    output: DEFAULT_OUTPUT_SETTINGS,
    server: { id: serverId, origin },
    updates: { ...DEFAULT_UPDATE_SETTINGS },
    lastAccountId: null,
  }
  const entries = await Promise.all(clips.map((clip) => entryOf({ clip, serverId, at })))
  const seeded: DownloadsState = {
    version: DOWNLOADS_VERSION,
    entries,
    autoDeleteDefault: false,
    owed: [],
  }
  if (!isDownloadsState(seeded)) throw new Error('The seeded downloads are not what main reads.')
  await Promise.all(
    entries.map((entry, index) => place({ userData, entry, path: clips[index]?.path ?? '' })),
  )
  await Promise.all([
    writeFile(join(userData, CONFIG_FILE), JSON.stringify(config)),
    writeFile(join(userData, DOWNLOADS_FILE), JSON.stringify(seeded)),
  ])
  return { serverId }
}

type RowOfProps = { page: Page; label: string }

/** A download's own row on Downloads: the innermost item naming it, inside its title's group. */
export const rowOf = ({ page, label }: RowOfProps) =>
  page.getByRole('listitem').filter({ hasText: label, hasNot: page.getByRole('listitem') })

type PlayDownloadProps = { page: Page; label: string }

/** Play on a ready download's row, with Downloads open: the one way a file reaches the player. */
export const playDownload = async ({ page, label }: PlayDownloadProps): Promise<void> => {
  await rowOf({ page, label })
    .getByRole('button', { name: `Play ${label}`, exact: true })
    .click()
}
