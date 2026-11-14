import {
  coverOf,
  DOWNLOAD_KINDS,
  DOWNLOAD_MAX_FILES,
  DOWNLOAD_TARGET_KINDS,
  type DownloadArtwork,
  type DownloadGroup,
  type DownloadKind,
  type DownloadLibrary,
  type DownloadTarget,
  draftOfItem,
  draftOfMedia,
  draftOfSaga,
  type Guard,
  isAlbumDetails,
  isItemDetails,
  isLibrary,
  isMediaItem,
  isPlaylistDetails,
  isSagaList,
  type ItemDetails,
  type Library,
  libraryOf,
  LOCKED_STATUS,
  type MediaItem,
  oncePerFile,
  artworkOfMedia,
  seasonIdsOf,
  type TitleEntry,
  titleItemIdOf,
  type Track,
  DOWNLOAD_GROUP_PREFIXES,
  downloadGroupKey,
} from '@raven/core'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseJson } from '@/main/parseJson'
import { CALL_NAMES, type AllowedCall } from '@/main/servers/allowlist'
import { SERVER_NAME } from '@/main/desktopConfig'
import { accountRefusalOf } from '@/main/servers/authRefusals'
import { CALL_MESSAGES, isBusyRefusal, type ServerCalls } from '@/main/servers/serverCalls'
import { HTTP_STATUSES, isSuccessStatus } from '@shared/http'

export type ExpandedFile = {
  media: MediaItem
  label: string
  group: DownloadGroup
  artwork: DownloadArtwork
  /** The library the file is in, as the server names it now. */
  library: DownloadLibrary
  /** The item whose poster and title art the file wears, its show's for an episode; null for none. */
  titleItemId: number | null
  watchedPercent: number
  /** The track a music file is, which its download keeps; none for a video. */
  track?: Track
}

export const EXPAND_REASONS = {
  locked: 'locked',
  gone: 'gone',
  unreachable: 'unreachable',
  tooMany: 'tooMany',
  unreadable: 'unreadable',
  account: 'account',
} as const

export type Expansion =
  | { ok: true; kind: DownloadKind; title: string; files: ExpandedFile[] }
  | {
      ok: false
      reason: (typeof EXPAND_REASONS)[keyof typeof EXPAND_REASONS]
      message: string
    }

export const EXPAND_MESSAGES = {
  tooMany: 'That is more than Raven downloads at once.',
  gone: `That title is not on ${SERVER_NAME} any more.`,
  unreadable: `${SERVER_NAME} answered with something Raven could not read.`,
  account: `${SERVER_NAME} did not let your account download that.`,
  locked: `${SERVER_NAME} keeps that behind its PIN.`,
} as const

type Failure = Extract<Expansion, { ok: false }>
type Read<T> = { ok: true; value: T } | { ok: false; failure: Failure }
/** One file of a title; a music file also carries the track it is. */
type Entry = TitleEntry & { track?: Track }
/** A group before each file takes its place in it. */
type UnorderedGroup<G = DownloadGroup> = G extends DownloadGroup ? Omit<G, 'order'> : never
type Draft = {
  title: string
  group: UnorderedGroup
  /** The picture every file of the title shows; none leaves each file its own. */
  artwork: DownloadArtwork | null
  entries: Entry[]
}
type MusicGroup = Extract<UnorderedGroup, { cover: unknown }>

const albumGroupKey = (albumId: number): string =>
  downloadGroupKey({ prefix: DOWNLOAD_GROUP_PREFIXES.album, ids: [albumId] })

const playlistGroupKey = (playlistId: number): string =>
  downloadGroupKey({ prefix: DOWNLOAD_GROUP_PREFIXES.playlist, ids: [playlistId] })

type Calls = Pick<ServerCalls, 'call'>
type Server = { calls: Calls }

const fail = ({ reason, message }: Pick<Failure, 'reason' | 'message'>): Read<never> => ({
  ok: false,
  failure: { ok: false, reason, message },
})

/** How often a call the server is too busy for is asked again, and how long apart. */
export const BUSY_TRIES = 4
export const BUSY_WAIT_MS = 250

type CallUnlessBusyProps = {
  calls: Calls
  call: AllowedCall
  triesLeft: number
}

/**
 * The call's answer, asked again after a short wait while every slot to the server is taken: a
 * download running, or a second ask, takes slots of its own while a long album is listed.
 */
const callUnlessBusy = async ({
  calls,
  call,
  triesLeft,
}: CallUnlessBusyProps): ReturnType<Calls['call']> => {
  const result = await calls.call({ call })
  if (!isBusyRefusal(result) || triesLeft <= 1) return result
  await sleep(BUSY_WAIT_MS)
  return callUnlessBusy({ calls, call, triesLeft: triesLeft - 1 })
}

type ReadProps<T> = Server & { call: AllowedCall; guard: Guard<T> }

const read = async <T>({ calls, call, guard }: ReadProps<T>): Promise<Read<T>> => {
  const result = await callUnlessBusy({ calls, call, triesLeft: BUSY_TRIES })
  if (!result.ok) return fail({ reason: EXPAND_REASONS.unreachable, message: result.message })
  if (result.status === LOCKED_STATUS) {
    return fail({ reason: EXPAND_REASONS.locked, message: EXPAND_MESSAGES.locked })
  }
  // A refusal of the account, rather than the server's accounts being down.
  if (accountRefusalOf(result) !== null) {
    return fail({ reason: EXPAND_REASONS.account, message: EXPAND_MESSAGES.account })
  }
  // With accounts, a title the account may not see is a 404 too, as the server answers anyone.
  if (result.status === HTTP_STATUSES.notFound) {
    return fail({ reason: EXPAND_REASONS.gone, message: EXPAND_MESSAGES.gone })
  }
  if (!isSuccessStatus(result.status)) {
    return fail({ reason: EXPAND_REASONS.unreachable, message: CALL_MESSAGES.unreachable })
  }
  const value = parseJson(result.body)
  return guard(value)
    ? { ok: true, value }
    : fail({ reason: EXPAND_REASONS.unreadable, message: EXPAND_MESSAGES.unreadable })
}

const GONE: Read<never> = fail({ reason: EXPAND_REASONS.gone, message: EXPAND_MESSAGES.gone })

type SeasonsOfProps = { server: Server; details: ItemDetails }

/** A show's seasons, read one after another; the first refusal answers for all. */
const seasonsOf = ({ server, details }: SeasonsOfProps): Promise<Read<ItemDetails[]>> =>
  seasonIdsOf(details).reduce<Promise<Read<ItemDetails[]>>>(
    async (previous, itemId) => {
      const soFar = await previous
      if (!soFar.ok) return soFar
      const season = await read({
        ...server,
        call: { name: CALL_NAMES.getItem, itemId },
        guard: isItemDetails,
      })
      if (!season.ok) return season
      return { ok: true, value: [...soFar.value, season.value] }
    },
    Promise.resolve({ ok: true, value: [] }),
  )

type DraftOfDetailsProps = { server: Server; details: ItemDetails }

const draftOfDetails = async ({ server, details }: DraftOfDetailsProps): Promise<Read<Draft>> => {
  const seasons = await seasonsOf({ server, details })
  if (!seasons.ok) return seasons
  const draft = draftOfItem({ details, seasons: seasons.value })
  return draft === null ? GONE : { ok: true, value: draft }
}

/** How many of a music group's files main reads at once, well under `serverCalls`' six reads in flight. */
const MEDIA_READS_AT_ONCE = 2

type ReadMediaProps = { server: Server; mediaIds: readonly number[] }

/** Each file a track is, in the order asked, a few at a time; the first refusal answers for all. */
const readMedia = ({ server, mediaIds }: ReadMediaProps): Promise<Read<MediaItem[]>> =>
  Array.from({ length: Math.ceil(mediaIds.length / MEDIA_READS_AT_ONCE) }, (_, index) =>
    mediaIds.slice(index * MEDIA_READS_AT_ONCE, (index + 1) * MEDIA_READS_AT_ONCE),
  ).reduce<Promise<Read<MediaItem[]>>>(
    async (previous, batch) => {
      const soFar = await previous
      if (!soFar.ok) return soFar
      const reads = await Promise.all(
        batch.map((mediaId) =>
          read({ ...server, call: { name: CALL_NAMES.getMedia, mediaId }, guard: isMediaItem }),
        ),
      )
      return reads.reduce<Read<MediaItem[]>>((all, one) => {
        if (!all.ok) return all
        return one.ok ? { ok: true, value: [...all.value, one.value] } : one
      }, soFar)
    },
    Promise.resolve({ ok: true, value: [] }),
  )

/** A playlist may hold a track twice; it is fetched once, in its first place. */
const oncePerTrack = (tracks: readonly Track[]): Track[] =>
  tracks.filter((track, index) => tracks.findIndex(({ id }) => id === track.id) === index)

type DraftOfTracksProps = {
  server: Server
  group: MusicGroup
  tracks: readonly Track[]
  skip: (mediaId: number) => boolean
}

/**
 * A track's `Track` names no size or position, so each one not already downloaded is read as a
 * file. The cap counts every track, skipped or not, before any is read.
 */
const draftOfTracks = async ({
  server,
  group,
  tracks,
  skip,
}: DraftOfTracksProps): Promise<Read<Draft>> => {
  const unique = oncePerTrack(tracks)
  if (unique.length > DOWNLOAD_MAX_FILES) {
    return fail({ reason: EXPAND_REASONS.tooMany, message: EXPAND_MESSAGES.tooMany })
  }
  const wanted = unique.flatMap((track, order) => (skip(track.id) ? [] : [{ track, order }]))
  const media = await readMedia({ server, mediaIds: wanted.map(({ track }) => track.id) })
  if (!media.ok) return media
  return {
    ok: true,
    value: {
      title: group.title,
      group,
      artwork: coverOf({ cover: group.cover }),
      entries: wanted.flatMap(({ track, order }, index) => {
        const file = media.value[index]
        return file === undefined ? [] : [{ media: file, label: track.title, order, track }]
      }),
    },
  }
}

/** An album's tracks by disc, then by number, as its page lists them. */
const inDiscOrder = (tracks: readonly Track[]): Track[] =>
  tracks.toSorted(
    (left, right) =>
      left.disc - right.disc ||
      (left.number ?? Number.MAX_SAFE_INTEGER) - (right.number ?? Number.MAX_SAFE_INTEGER),
  )

type DraftOfProps = {
  server: Server
  target: DownloadTarget
  skip: (mediaId: number) => boolean
}

const draftOf = async ({ server, target, skip }: DraftOfProps): Promise<Read<Draft>> => {
  switch (target.kind) {
    case DOWNLOAD_TARGET_KINDS.media: {
      const media = await read({
        ...server,
        call: { name: CALL_NAMES.getMedia, mediaId: target.mediaId },
        guard: isMediaItem,
      })
      return media.ok ? { ok: true, value: draftOfMedia(media.value) } : media
    }
    case DOWNLOAD_TARGET_KINDS.item: {
      const details = await read({
        ...server,
        call: { name: CALL_NAMES.getItem, itemId: target.itemId },
        guard: isItemDetails,
      })
      return details.ok ? draftOfDetails({ server, details: details.value }) : details
    }
    case DOWNLOAD_TARGET_KINDS.saga: {
      const sagas = await read({
        ...server,
        call: { name: CALL_NAMES.getSagas, libraryId: target.libraryId },
        guard: isSagaList,
      })
      if (!sagas.ok) return sagas
      const saga = sagas.value.find(({ tmdbId }) => tmdbId === target.tmdbId)
      if (saga === undefined) return GONE
      return { ok: true, value: draftOfSaga({ saga, libraryId: target.libraryId }) }
    }
    case DOWNLOAD_TARGET_KINDS.album: {
      const details = await read({
        ...server,
        call: { name: CALL_NAMES.getAlbum, albumId: target.albumId },
        guard: isAlbumDetails,
      })
      if (!details.ok) return details
      const { album, tracks } = details.value
      return draftOfTracks({
        server,
        skip,
        tracks: inDiscOrder(tracks),
        group: {
          kind: DOWNLOAD_KINDS.album,
          key: albumGroupKey(album.id),
          title: album.title,
          cover: { albumId: album.id, coverVersion: album.coverVersion },
          sourceId: album.id,
        },
      })
    }
    case DOWNLOAD_TARGET_KINDS.playlist: {
      // A locked library's tracks are left out of the playlist by the server, so none is asked for.
      const details = await read({
        ...server,
        call: { name: CALL_NAMES.getPlaylist, playlistId: target.playlistId },
        guard: isPlaylistDetails,
      })
      if (!details.ok) return details
      const { playlist, tracks } = details.value
      const [first] = tracks
      return draftOfTracks({
        server,
        skip,
        tracks,
        group: {
          kind: DOWNLOAD_KINDS.playlist,
          key: playlistGroupKey(playlist.id),
          title: playlist.name,
          cover:
            first === undefined
              ? null
              : { albumId: first.albumId, coverVersion: first.album.coverVersion },
          sourceId: playlist.id,
        },
      })
    }
    default: {
      const unreachable: never = target
      return unreachable
    }
  }
}

type LibrariesOfProps = {
  server: Server
  libraryIds: number[]
}

/** Each library, read once however many files it holds. */
const librariesOf = ({
  server,
  libraryIds,
}: LibrariesOfProps): Promise<Read<Record<number, Library>>> =>
  libraryIds.reduce<Promise<Read<Record<number, Library>>>>(
    async (previous, libraryId) => {
      const soFar = await previous
      if (!soFar.ok) return soFar
      const library = await read({
        ...server,
        call: { name: CALL_NAMES.getLibrary, libraryId },
        guard: isLibrary,
      })
      if (!library.ok) return library
      return {
        ok: true,
        value: { ...soFar.value, [libraryId]: library.value },
      }
    },
    Promise.resolve({ ok: true, value: {} }),
  )

/** Turns a download link's target into the media files to fetch, through the allowlisted server calls. */
type ExpandTargetProps = Server & {
  target: DownloadTarget
  skip: (mediaId: number) => boolean
}

export const expandTarget = async ({
  calls,
  target,
  skip,
}: ExpandTargetProps): Promise<Expansion> => {
  const server = { calls }
  const draft = await draftOf({ server, target, skip })
  if (!draft.ok) return draft.failure
  const { title, group, artwork } = draft.value
  const entries = oncePerFile(draft.value.entries)
  if (entries.length > DOWNLOAD_MAX_FILES) {
    return { ok: false, reason: EXPAND_REASONS.tooMany, message: EXPAND_MESSAGES.tooMany }
  }
  const kept = entries.filter(({ media }) => !skip(media.id))
  const libraryIds = [...new Set(kept.map(({ media }) => media.libraryId))]
  const libraries = await librariesOf({ server, libraryIds })
  if (!libraries.ok) return libraries.failure
  return {
    ok: true,
    kind: group.kind,
    title,
    files: kept.map(({ media, label, order, track }) => {
      const library = libraries.value[media.libraryId]
      return {
        media,
        label,
        group: { ...group, order },
        artwork: artwork ?? artworkOfMedia(media),
        library: libraryOf(library),
        titleItemId: titleItemIdOf(media),
        watchedPercent: library.settings.watchedPercent,
        track,
      }
    }),
  }
}
