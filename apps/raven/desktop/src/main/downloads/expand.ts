import {
  episodeCode,
  isAdminLock,
  isItemDetails,
  isLibrary,
  isMediaItem,
  isSagaList,
  itemLabel,
  LOCKED_STATUS,
  mediaLabel,
  type DownloadTarget,
  type Guard,
  type ItemDetails,
  type ItemSummary,
  type MediaItem,
} from '@raven/core'
import type { AllowedCall } from '@/main/servers/allowlist'
import { CALL_MESSAGES, type ServerCalls } from '@/main/servers/serverCalls'
import type { DownloadGroup, DownloadKind } from '@/shared/protocol'

export const DOWNLOAD_MAX_FILES = 500

export type ExpandedFile = {
  media: MediaItem
  label: string
  group: DownloadGroup
  watchedPercent: number
}

export type Expansion =
  | { ok: true; kind: DownloadKind; title: string; files: ExpandedFile[] }
  | {
      ok: false
      reason: 'locked' | 'hidden' | 'gone' | 'unreachable' | 'tooMany' | 'unreadable'
      message: string
    }

export const EXPAND_MESSAGES = {
  tooMany: 'That is more than raven player downloads at once.',
  gone: (name: string) => `That title is not on ${name} any more.`,
  unreadable: (name: string) => `${name} answered with something raven player could not read.`,
} as const

const LOCKED_MESSAGE = (name: string): string => `${name} keeps that behind its PIN.`
const HIDDEN_MESSAGE = (name: string): string => `${name} keeps that behind its admin password.`

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
  if (type === 'show') return `show:${id}`
  // The server names no show only for a season or episode it cannot place under one.
  return show === null ? `item:${id}` : `show:${show.id}`
}

const movieGroupKey = (media: MediaItem): string => `movie:${media.id}`

const sagaGroupKey = ({ libraryId, tmdbId }: { libraryId: number; tmdbId: string }): string =>
  `saga:${libraryId}:${tmdbId}`

const isSuccess = (status: number): boolean => status >= 200 && status < 300

const parse = (body: string): unknown => {
  try {
    const value: unknown = JSON.parse(body)
    return value
  } catch {
    return undefined
  }
}

const fail = ({ reason, message }: Pick<Failure, 'reason' | 'message'>): Read<never> => ({
  ok: false,
  failure: { ok: false, reason, message },
})

/** Whether a 404 is the admin lock hiding the title, which the admin password lifts. */
const isHiddenByAdminLock = async ({ calls, serverId }: Pick<Server, 'calls' | 'serverId'>) => {
  const result = await calls.call({ serverId, call: { name: 'getAdminLock' } })
  if (!result.ok || !isSuccess(result.status)) return false
  const lock = parse(result.body)
  return isAdminLock(lock) && lock.state === 'on' && lock.available
}

const read = async <T>({
  calls,
  serverId,
  serverName,
  call,
  guard,
}: Server & { call: AllowedCall; guard: Guard<T> }): Promise<Read<T>> => {
  const result = await calls.call({ serverId, call })
  if (!result.ok) return fail({ reason: 'unreachable', message: result.message })
  if (result.status === LOCKED_STATUS) {
    return fail({ reason: 'locked', message: LOCKED_MESSAGE(serverName) })
  }
  if (result.status === 404) {
    return (await isHiddenByAdminLock({ calls, serverId }))
      ? fail({ reason: 'hidden', message: HIDDEN_MESSAGE(serverName) })
      : fail({ reason: 'gone', message: EXPAND_MESSAGES.gone(serverName) })
  }
  if (!isSuccess(result.status)) {
    return fail({ reason: 'unreachable', message: CALL_MESSAGES.unreachable(serverName) })
  }
  const value = parse(result.body)
  return guard(value)
    ? { ok: true, value }
    : fail({ reason: 'unreadable', message: EXPAND_MESSAGES.unreadable(serverName) })
}

const episodesOf = (details: ItemDetails): Entry[] =>
  details.children.flatMap((child) =>
    child.type === 'episode' && child.primary !== null
      ? [{ media: child.primary, label: episodeLabel(child), order: episodeOrder(child) }]
      : [],
  )

const goneFor = (server: Server): Read<never> =>
  fail({ reason: 'gone', message: EXPAND_MESSAGES.gone(server.serverName) })

const draftOfMedia = (media: MediaItem): Draft => {
  const item = media.item
  if (item?.type !== 'episode') {
    const title = mediaLabel(media)
    return {
      kind: 'movie',
      title,
      groupTitle: title,
      groupKey: movieGroupKey(media),
      entries: [{ media, label: title, order: 0 }],
    }
  }
  return {
    kind: 'episode',
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
  const seasonIds = details.children.flatMap((child) => (child.type === 'season' ? [child.id] : []))
  const entries = await seasonIds.reduce<Promise<Read<Entry[]>>>(
    async (previous, itemId) => {
      const soFar = await previous
      if (!soFar.ok) return soFar
      const season = await read({
        ...server,
        call: { name: 'getItem', itemId },
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
      kind: 'show',
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
    case 'movie': {
      if (first === undefined) return goneFor(server)
      return {
        ok: true,
        value: { ...draftOfMedia(first), kind: 'movie', groupKey: movieGroupKey(first) },
      }
    }
    case 'episode': {
      if (first === undefined) return goneFor(server)
      return {
        ok: true,
        value: {
          kind: 'episode',
          title: itemLabel(details),
          groupTitle: details.show?.title ?? details.title,
          groupKey: showGroupKey(details),
          entries: [{ media: first, label: episodeLabel(details), order: episodeOrder(details) }],
        },
      }
    }
    case 'season':
      return {
        ok: true,
        value: {
          kind: 'season',
          title: itemLabel(details),
          groupTitle: details.show?.title ?? details.title,
          groupKey: showGroupKey(details),
          entries: episodesOf(details),
        },
      }
    case 'show':
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
    case 'media': {
      const media = await read({
        ...server,
        call: { name: 'getMedia', mediaId: target.mediaId },
        guard: isMediaItem,
      })
      return media.ok ? { ok: true, value: draftOfMedia(media.value) } : media
    }
    case 'item': {
      const details = await read({
        ...server,
        call: { name: 'getItem', itemId: target.itemId },
        guard: isItemDetails,
      })
      return details.ok ? draftOfItem({ server, details: details.value }) : details
    }
    case 'saga': {
      const sagas = await read({
        ...server,
        call: { name: 'getSagas', libraryId: target.libraryId },
        guard: isSagaList,
      })
      if (!sagas.ok) return sagas
      const saga = sagas.value.find(({ tmdbId }) => tmdbId === target.tmdbId)
      if (saga === undefined) return goneFor(server)
      return {
        ok: true,
        value: {
          kind: 'saga',
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
        call: { name: 'getLibrary', libraryId },
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
  const { kind, title, groupTitle, groupKey, entries } = draft.value
  if (entries.length > DOWNLOAD_MAX_FILES) {
    return { ok: false, reason: 'tooMany', message: EXPAND_MESSAGES.tooMany }
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
      watchedPercent: percents.value[media.libraryId] ?? 0,
    })),
  }
}
