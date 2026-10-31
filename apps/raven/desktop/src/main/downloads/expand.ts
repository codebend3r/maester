import {
  AUTH_REFUSALS,
  DOWNLOAD_KINDS,
  DOWNLOAD_TARGET_KINDS,
  type DownloadGroup,
  type DownloadKind,
  type DownloadTarget,
  episodeCode,
  type Guard,
  isAlbumDetails,
  isItemDetails,
  isLibrary,
  isMediaItem,
  isPlaylistDetails,
  isSagaList,
  ITEM_TYPES,
  type ItemDetails,
  itemLabel,
  type ItemSummary,
  LOCKED_STATUS,
  type MediaItem,
  mediaLabel,
  type Track,
} from '@raven/core'
import { parseJson } from '@/main/parseJson'
import { CALL_NAMES, type AllowedCall } from '@/main/servers/allowlist'
import { ACCOUNT_REFUSAL_STATUSES, refusalAt } from '@/main/servers/authRefusals'
import { CALL_MESSAGES, type ServerCalls } from '@/main/servers/serverCalls'
import { HTTP_STATUSES, isSuccessStatus } from '@/shared/httpStatuses'

export const DOWNLOAD_MAX_FILES = 500

export type ExpandedFile = {
  media: MediaItem
  label: string
  group: DownloadGroup
  watchedPercent: number
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
  gone: (name: string) => `That title is not on ${name} any more.`,
  unreadable: (name: string) => `${name} answered with something Raven could not read.`,
  account: (name: string) => `${name} did not let your account download that.`,
} as const

const LOCKED_MESSAGE = (name: string): string => `${name} keeps that behind its PIN.`

type Failure = Extract<Expansion, { ok: false }>
type Read<T> = { ok: true; value: T } | { ok: false; failure: Failure }
type Entry = { media: MediaItem; label: string; order: number }
/** A group before each file takes its place in it. */
type UnorderedGroup<G = DownloadGroup> = G extends DownloadGroup ? Omit<G, 'order'> : never
type Draft = { title: string; group: UnorderedGroup; entries: Entry[] }
type MusicGroup = Extract<UnorderedGroup, { cover: unknown }>
type Calls = Pick<ServerCalls, 'call'>
type Server = { calls: Calls; serverId: string; serverName: string }

type EpisodeLabelProps = {
  season: number | null
  episode: number | null
  title: string
}

export const episodeLabel = ({ season, episode, title }: EpisodeLabelProps): string => {
  const code = season === null || episode === null ? null : episodeCode({ season, episode })
  return code === null ? title : `${code} ${title}`
}

type EpisodeOrderProps = {
  season: number | null
  episode: number | null
}

const episodeOrder = ({ season, episode }: EpisodeOrderProps): number =>
  (season ?? 0) * 10_000 + (episode ?? 0)

/** An episode, its season and its show share one group, whichever of them was asked for. */
const showGroupKey = ({ id, type, show }: Pick<ItemSummary, 'id' | 'type' | 'show'>): string => {
  if (type === ITEM_TYPES.show) return `show:${id}`
  // The server names no show only for a season or episode it cannot place under one.
  return show === null ? `item:${id}` : `show:${show.id}`
}

const movieGroupKey = (media: MediaItem): string => `movie:${media.id}`

type SagaGroupKeyProps = { libraryId: number; tmdbId: string }

const sagaGroupKey = ({ libraryId, tmdbId }: SagaGroupKeyProps): string =>
  `saga:${libraryId}:${tmdbId}`

/** Both episodes of a two-episode file name that one file as their `primary`: it is fetched once, as the first. */
const oncePerFile = (entries: readonly Entry[]): Entry[] => [
  ...entries
    .reduce(
      (byMedia, entry) =>
        byMedia.has(entry.media.id) ? byMedia : byMedia.set(entry.media.id, entry),
      new Map<number, Entry>(),
    )
    .values(),
]

const fail = ({ reason, message }: Pick<Failure, 'reason' | 'message'>): Read<never> => ({
  ok: false,
  failure: { ok: false, reason, message },
})

type IsAccountRefusedProps = { status: number; body: string }

/** Whether a 401 or 403 is the account refused, rather than the server's accounts being down. */
const isAccountRefused = (result: IsAccountRefusedProps): boolean => {
  const reason = refusalAt({ ...result, statuses: ACCOUNT_REFUSAL_STATUSES })
  return reason !== null && reason !== AUTH_REFUSALS.unavailable
}

const read = async <T>({
  calls,
  serverId,
  serverName,
  call,
  guard,
}: Server & { call: AllowedCall; guard: Guard<T> }): Promise<Read<T>> => {
  const result = await calls.call({ serverId, call })
  if (!result.ok) return fail({ reason: EXPAND_REASONS.unreachable, message: result.message })
  if (result.status === LOCKED_STATUS) {
    return fail({ reason: EXPAND_REASONS.locked, message: LOCKED_MESSAGE(serverName) })
  }
  if (isAccountRefused(result)) {
    return fail({ reason: EXPAND_REASONS.account, message: EXPAND_MESSAGES.account(serverName) })
  }
  // With accounts, a title the account may not see is a 404 too, as the server answers anyone.
  if (result.status === HTTP_STATUSES.notFound) {
    return fail({ reason: EXPAND_REASONS.gone, message: EXPAND_MESSAGES.gone(serverName) })
  }
  if (!isSuccessStatus(result.status)) {
    return fail({
      reason: EXPAND_REASONS.unreachable,
      message: CALL_MESSAGES.unreachable(serverName),
    })
  }
  const value = parseJson(result.body)
  return guard(value)
    ? { ok: true, value }
    : fail({ reason: EXPAND_REASONS.unreadable, message: EXPAND_MESSAGES.unreadable(serverName) })
}

const episodesOf = (details: ItemDetails): Entry[] =>
  details.children.flatMap((child) =>
    child.type === ITEM_TYPES.episode && child.primary !== null
      ? [{ media: child.primary, label: episodeLabel(child), order: episodeOrder(child) }]
      : [],
  )

const goneFor = (server: Server): Read<never> =>
  fail({ reason: EXPAND_REASONS.gone, message: EXPAND_MESSAGES.gone(server.serverName) })

const draftOfMedia = (media: MediaItem): Draft => {
  const item = media.item
  if (item?.type !== ITEM_TYPES.episode) {
    const title = mediaLabel(media)
    return {
      title,
      group: { kind: DOWNLOAD_KINDS.movie, key: movieGroupKey(media), title },
      entries: [{ media, label: title, order: 0 }],
    }
  }
  return {
    title: mediaLabel(media),
    group: {
      kind: DOWNLOAD_KINDS.episode,
      key: showGroupKey(item),
      title: item.show?.title ?? item.title,
    },
    entries: [{ media, label: episodeLabel(item), order: episodeOrder(item) }],
  }
}

type DraftOfShowProps = {
  server: Server
  details: ItemDetails
}

const draftOfShow = async ({ server, details }: DraftOfShowProps): Promise<Read<Draft>> => {
  const seasonIds = details.children.flatMap((child) =>
    child.type === ITEM_TYPES.season ? [child.id] : [],
  )
  const entries = await seasonIds.reduce<Promise<Read<Entry[]>>>(
    async (previous, itemId) => {
      const soFar = await previous
      if (!soFar.ok) return soFar
      const season = await read({
        ...server,
        call: { name: CALL_NAMES.getItem, itemId },
        guard: isItemDetails,
      })
      if (!season.ok) return season
      return { ok: true, value: soFar.value.concat(episodesOf(season.value)) }
    },
    Promise.resolve({ ok: true, value: [] }),
  )
  if (!entries.ok) return entries
  return {
    ok: true,
    value: {
      title: details.title,
      group: { kind: DOWNLOAD_KINDS.show, key: showGroupKey(details), title: details.title },
      entries: entries.value,
    },
  }
}

type DraftOfItemProps = {
  server: Server
  details: ItemDetails
}

const draftOfItem = async ({ server, details }: DraftOfItemProps): Promise<Read<Draft>> => {
  const first = details.versions[0]
  switch (details.type) {
    case ITEM_TYPES.movie: {
      if (first === undefined) return goneFor(server)
      const draft = draftOfMedia(first)
      return {
        ok: true,
        value: {
          ...draft,
          group: {
            kind: DOWNLOAD_KINDS.movie,
            key: movieGroupKey(first),
            title: draft.group.title,
          },
        },
      }
    }
    case ITEM_TYPES.episode: {
      if (first === undefined) return goneFor(server)
      return {
        ok: true,
        value: {
          title: itemLabel(details),
          group: {
            kind: DOWNLOAD_KINDS.episode,
            key: showGroupKey(details),
            title: details.show?.title ?? details.title,
          },
          entries: [{ media: first, label: episodeLabel(details), order: episodeOrder(details) }],
        },
      }
    }
    case ITEM_TYPES.season:
      return {
        ok: true,
        value: {
          title: itemLabel(details),
          group: {
            kind: DOWNLOAD_KINDS.season,
            key: showGroupKey(details),
            title: details.show?.title ?? details.title,
          },
          entries: episodesOf(details),
        },
      }
    case ITEM_TYPES.show:
      return draftOfShow({ server, details })
    default: {
      const unreachable: never = details.type
      return unreachable
    }
  }
}

/** How many of a music group's files main reads at once, under `serverCalls`' six reads in flight. */
const MEDIA_READS_AT_ONCE = 4

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
      entries: wanted.flatMap(({ track, order }, index) => {
        const file = media.value[index]
        return file === undefined ? [] : [{ media: file, label: track.title, order }]
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
      return details.ok ? draftOfItem({ server, details: details.value }) : details
    }
    case DOWNLOAD_TARGET_KINDS.saga: {
      const sagas = await read({
        ...server,
        call: { name: CALL_NAMES.getSagas, libraryId: target.libraryId },
        guard: isSagaList,
      })
      if (!sagas.ok) return sagas
      const saga = sagas.value.find(({ tmdbId }) => tmdbId === target.tmdbId)
      if (saga === undefined) return goneFor(server)
      return {
        ok: true,
        value: {
          title: saga.name,
          group: { kind: DOWNLOAD_KINDS.saga, key: sagaGroupKey(target), title: saga.name },
          entries: saga.media.map((media, order) => ({ media, label: mediaLabel(media), order })),
        },
      }
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
          key: `album:${album.id}`,
          title: album.title,
          cover: { albumId: album.id, coverVersion: album.coverVersion },
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
          key: `playlist:${playlist.id}`,
          title: playlist.name,
          cover:
            first === undefined
              ? null
              : { albumId: first.albumId, coverVersion: first.album.coverVersion },
        },
      })
    }
    default: {
      const unreachable: never = target
      return unreachable
    }
  }
}

type WatchedPercentsProps = {
  server: Server
  libraryIds: number[]
}

/** Each library's `watchedPercent`, read once however many files it holds. */
const watchedPercents = ({
  server,
  libraryIds,
}: WatchedPercentsProps): Promise<Read<Record<number, number>>> =>
  libraryIds.reduce<Promise<Read<Record<number, number>>>>(
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
        value: { ...soFar.value, [libraryId]: library.value.settings.watchedPercent },
      }
    },
    Promise.resolve({ ok: true, value: {} }),
  )

/** Turns a download link's target into the media files to fetch, through the allowlisted server calls. */
export const expandTarget = async ({
  calls,
  serverId,
  serverName,
  target,
  skip,
}: Server & {
  target: DownloadTarget
  skip: (mediaId: number) => boolean
}): Promise<Expansion> => {
  const server = { calls, serverId, serverName }
  const draft = await draftOf({ server, target, skip })
  if (!draft.ok) return draft.failure
  const { title, group } = draft.value
  const entries = oncePerFile(draft.value.entries)
  if (entries.length > DOWNLOAD_MAX_FILES) {
    return { ok: false, reason: EXPAND_REASONS.tooMany, message: EXPAND_MESSAGES.tooMany }
  }
  const kept = entries.filter(({ media }) => !skip(media.id))
  const libraryIds = [...new Set(kept.map(({ media }) => media.libraryId))]
  const percents = await watchedPercents({ server, libraryIds })
  if (!percents.ok) return percents.failure
  return {
    ok: true,
    kind: group.kind,
    title,
    files: kept.map(({ media, label, order }) => ({
      media,
      label,
      group: { ...group, order },
      watchedPercent: percents.value[media.libraryId],
    })),
  }
}
