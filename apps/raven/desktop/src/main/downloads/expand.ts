import {
  AUTH_REFUSALS,
  DOWNLOAD_KINDS,
  DOWNLOAD_TARGET_KINDS,
  type DownloadGroup,
  type DownloadKind,
  type DownloadTarget,
  episodeCode,
  type Guard,
  isItemDetails,
  isLibrary,
  isMediaItem,
  isSagaList,
  ITEM_TYPES,
  type ItemDetails,
  itemLabel,
  type ItemSummary,
  LOCKED_STATUS,
  type MediaItem,
  mediaLabel,
} from '@raven/core'
import { parseJson } from '@/main/parseJson'
import { CALL_NAMES, type AllowedCall } from '@/main/servers/allowlist'
import { ACCOUNT_REFUSAL_STATUSES, refusalAt } from '@/main/servers/authRefusals'
import { CALL_MESSAGES, type ServerCalls } from '@/main/servers/serverCalls'
import { HTTP_STATUSES } from '@/shared/httpStatuses'

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
type Draft = {
  kind: DownloadKind
  title: string
  groupTitle: string
  groupKey: string
  entries: Entry[]
}
type Calls = Pick<ServerCalls, 'call'>
type Server = { calls: Calls; serverId: string; serverName: string }

export const episodeLabel = ({
  season,
  episode,
  title,
}: {
  season: number | null
  episode: number | null
  title: string
}): string => {
  const code = season === null || episode === null ? null : episodeCode({ season, episode })
  return code === null ? title : `${code} ${title}`
}

const episodeOrder = ({
  season,
  episode,
}: {
  season: number | null
  episode: number | null
}): number => (season ?? 0) * 10_000 + (episode ?? 0)

/** An episode, its season and its show share one group, whichever of them was asked for. */
const showGroupKey = ({ id, type, show }: Pick<ItemSummary, 'id' | 'type' | 'show'>): string => {
  if (type === ITEM_TYPES.show) return `show:${id}`
  // The server names no show only for a season or episode it cannot place under one.
  return show === null ? `item:${id}` : `show:${show.id}`
}

const movieGroupKey = (media: MediaItem): string => `movie:${media.id}`

const sagaGroupKey = ({ libraryId, tmdbId }: { libraryId: number; tmdbId: string }): string =>
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

const isSuccess = (status: number): boolean => status >= 200 && status < 300

const fail = ({ reason, message }: Pick<Failure, 'reason' | 'message'>): Read<never> => ({
  ok: false,
  failure: { ok: false, reason, message },
})

/** Whether a 401 or 403 is the account refused, rather than the server's accounts being down. */
const isAccountRefused = (result: { status: number; body: string }): boolean => {
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
  if (!isSuccess(result.status)) {
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
      kind: DOWNLOAD_KINDS.movie,
      title,
      groupTitle: title,
      groupKey: movieGroupKey(media),
      entries: [{ media, label: title, order: 0 }],
    }
  }
  return {
    kind: DOWNLOAD_KINDS.episode,
    title: mediaLabel(media),
    groupTitle: item.show?.title ?? item.title,
    groupKey: showGroupKey(item),
    entries: [{ media, label: episodeLabel(item), order: episodeOrder(item) }],
  }
}

const draftOfShow = async ({
  server,
  details,
}: {
  server: Server
  details: ItemDetails
}): Promise<Read<Draft>> => {
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
      kind: DOWNLOAD_KINDS.show,
      title: details.title,
      groupTitle: details.title,
      groupKey: showGroupKey(details),
      entries: entries.value,
    },
  }
}

const draftOfItem = async ({
  server,
  details,
}: {
  server: Server
  details: ItemDetails
}): Promise<Read<Draft>> => {
  const first = details.versions[0]
  switch (details.type) {
    case ITEM_TYPES.movie: {
      if (first === undefined) return goneFor(server)
      return {
        ok: true,
        value: {
          ...draftOfMedia(first),
          kind: DOWNLOAD_KINDS.movie,
          groupKey: movieGroupKey(first),
        },
      }
    }
    case ITEM_TYPES.episode: {
      if (first === undefined) return goneFor(server)
      return {
        ok: true,
        value: {
          kind: DOWNLOAD_KINDS.episode,
          title: itemLabel(details),
          groupTitle: details.show?.title ?? details.title,
          groupKey: showGroupKey(details),
          entries: [{ media: first, label: episodeLabel(details), order: episodeOrder(details) }],
        },
      }
    }
    case ITEM_TYPES.season:
      return {
        ok: true,
        value: {
          kind: DOWNLOAD_KINDS.season,
          title: itemLabel(details),
          groupTitle: details.show?.title ?? details.title,
          groupKey: showGroupKey(details),
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

const draftOf = async ({
  server,
  target,
}: {
  server: Server
  target: DownloadTarget
}): Promise<Read<Draft>> => {
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
          kind: DOWNLOAD_KINDS.saga,
          title: saga.name,
          groupTitle: saga.name,
          groupKey: sagaGroupKey(target),
          entries: saga.media.map((media, order) => ({ media, label: mediaLabel(media), order })),
        },
      }
    }
    default: {
      const unreachable: never = target
      return unreachable
    }
  }
}

/** Each library's `watchedPercent`, read once however many files it holds. */
const watchedPercents = ({
  server,
  libraryIds,
}: {
  server: Server
  libraryIds: number[]
}): Promise<Read<Record<number, number>>> =>
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
  const draft = await draftOf({ server, target })
  if (!draft.ok) return draft.failure
  const { kind, title, groupTitle, groupKey } = draft.value
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
    kind,
    title,
    files: kept.map(({ media, label, order }) => ({
      media,
      label,
      group: { kind, key: groupKey, title: groupTitle, order },
      watchedPercent: percents.value[media.libraryId],
    })),
  }
}
