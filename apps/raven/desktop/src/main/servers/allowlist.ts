import {
  AUTH_PARAMS,
  ROUTES,
  isMediaId,
  pathFor,
  isProgressChange,
  isProgressReport,
  SERVER_METHODS,
} from '@raven/core'
import { parseJson } from '@/main/parseJson'

export type ServerMethod = (typeof SERVER_METHODS)[keyof typeof SERVER_METHODS]
export const MAX_BODY = 4096

/** The calls main makes to the server, by name. */
export const CALL_NAMES = {
  getMedia: 'getMedia',
  getTracks: 'getTracks',
  saveProgress: 'saveProgress',
  recordPlay: 'recordPlay',
  getItem: 'getItem',
  getLibrary: 'getLibrary',
  getSagas: 'getSagas',
  getAlbum: 'getAlbum',
  getPlaylist: 'getPlaylist',
  getMediaOrigins: 'getMediaOrigins',
  getAccountTicket: 'getAccountTicket',
} as const

export type AllowedCall =
  | { name: typeof CALL_NAMES.getMedia; mediaId: number }
  | { name: typeof CALL_NAMES.getTracks; mediaId: number }
  | {
      name: typeof CALL_NAMES.saveProgress
      mediaId: number
      position: number
      audio: number | null
    }
  | { name: typeof CALL_NAMES.recordPlay; mediaId: number }
  | { name: typeof CALL_NAMES.getItem; itemId: number }
  | { name: typeof CALL_NAMES.getLibrary; libraryId: number }
  | { name: typeof CALL_NAMES.getSagas; libraryId: number }
  | { name: typeof CALL_NAMES.getAlbum; albumId: number }
  | { name: typeof CALL_NAMES.getPlaylist; playlistId: number }
  | { name: typeof CALL_NAMES.getMediaOrigins }
  | { name: typeof CALL_NAMES.getAccountTicket; mediaId: number }

/** The fixed paths among the calls; the numbered calls' paths carry an id. */
export const API_PATHS = {
  mediaOrigins: ROUTES.getMediaOrigins.path,
  media: '/api/media',
} as const

/** A request main sends: its method, its path and its JSON body, if any. */
export type AllowedRequest = { method: ServerMethod; path: string; body: string | null }

type BareRequestProps = { route: { method: ServerMethod; path: string }; id: number }

/** A call by id alone, with no body. */
const bareRequest = ({ route, id }: BareRequestProps): AllowedRequest => ({
  method: route.method,
  path: pathFor({ path: route.path, params: { [AUTH_PARAMS.id]: id } }),
  body: null,
})

/** A title's bytes under `${API_PATHS.media}/<id>/`, read with a ticket or a cookie. */
export const MEDIA_FILE_PATH = 'file'
/** A track as the server's AAC transcode, at the bitrate its query names. */
export const MEDIA_TRANSCODE_PATH = 'transcode'
const MEDIA_SUBTITLES_PATH = 'subtitles'

export const subtitlePathOf = (trackId: string): string => `${MEDIA_SUBTITLES_PATH}/${trackId}`

const BODY_KINDS = { none: 'none', json: 'json', bad: 'bad' } as const

type Body =
  | { kind: typeof BODY_KINDS.none }
  | { kind: typeof BODY_KINDS.json; value: unknown }
  | { kind: typeof BODY_KINDS.bad }

const ROUTE_KINDS = { numbered: 'numbered', fixed: 'fixed' } as const

type ReadProps = { id: number; body: Body }

type RouteReadProps = { body: Body }

type Route =
  | {
      kind: typeof ROUTE_KINDS.numbered
      method: ServerMethod
      pattern: RegExp
      read: (input: ReadProps) => AllowedCall | null
    }
  | {
      kind: typeof ROUTE_KINDS.fixed
      method: ServerMethod
      path: string
      read: (input: RouteReadProps) => AllowedCall | null
    }

const NONE = { kind: BODY_KINDS.none } as const satisfies Body

const readBody = (body: string | null): Body => {
  if (body === null) return NONE
  if (body.length > MAX_BODY) return { kind: BODY_KINDS.bad }
  const value = parseJson(body)
  return value === undefined ? { kind: BODY_KINDS.bad } : { kind: BODY_KINDS.json, value }
}

const ID_PARAM = `:${AUTH_PARAMS.id}`

type BareCallbackProps = { body: Body }

/** Only for the calls that take no body: anything sent along refuses the call. */
const bare =
  (call: AllowedCall) =>
  ({ body }: BareCallbackProps): AllowedCall | null =>
    body.kind === BODY_KINDS.none ? call : null

/** One placeholder's worth of a whole id: digits only, no leading zero, at most 16 of them. */
const ID_PATTERN = '([1-9]\\d{0,15})'

const ESCAPED = /[.*+?^${}()|[\]\\]/gu

/**
 * A route's path as a pattern that matches it whole, its one `:id` as digits. Matched on the
 * whole string, digits only, so no query, fragment, dot segment, escape, extra slash or absolute
 * URL can match; `$` without the `m` flag ends the input.
 */
const numberedPattern = (path: string): RegExp =>
  new RegExp(`^${path.replace(ESCAPED, '\\$&').replace(ID_PARAM, ID_PATTERN)}$`, 'u')

type NumberedRouteProps = {
  route: { method: ServerMethod; path: string }
  read: (input: ReadProps) => AllowedCall | null
}

const numbered = ({ route, read }: NumberedRouteProps): Route => ({
  kind: ROUTE_KINDS.numbered,
  method: route.method,
  pattern: numberedPattern(route.path),
  read,
})

const ALLOWED_ROUTES: readonly Route[] = [
  numbered({
    route: ROUTES.getMedia,
    read: ({ id, body }) => bare({ name: CALL_NAMES.getMedia, mediaId: id })({ body }),
  }),
  numbered({
    route: ROUTES.getTracks,
    read: ({ id, body }) => bare({ name: CALL_NAMES.getTracks, mediaId: id })({ body }),
  }),
  numbered({
    route: ROUTES.saveProgress,
    read: ({ id, body }) => {
      if (body.kind !== BODY_KINDS.json || !isProgressChange(body.value)) return null
      // An older page names no audio track; null tells the server it cannot tell.
      const audio = isProgressReport(body.value) ? body.value.audio : null
      return { name: CALL_NAMES.saveProgress, mediaId: id, position: body.value.position, audio }
    },
  }),
  numbered({
    route: ROUTES.recordPlay,
    read: ({ id, body }) => bare({ name: CALL_NAMES.recordPlay, mediaId: id })({ body }),
  }),
  numbered({
    route: ROUTES.getItem,
    read: ({ id, body }) => bare({ name: CALL_NAMES.getItem, itemId: id })({ body }),
  }),
  numbered({
    route: ROUTES.getLibrary,
    read: ({ id, body }) => bare({ name: CALL_NAMES.getLibrary, libraryId: id })({ body }),
  }),
  numbered({
    route: ROUTES.listSagas,
    read: ({ id, body }) => bare({ name: CALL_NAMES.getSagas, libraryId: id })({ body }),
  }),
  numbered({
    route: ROUTES.getAlbum,
    read: ({ id, body }) => bare({ name: CALL_NAMES.getAlbum, albumId: id })({ body }),
  }),
  numbered({
    route: ROUTES.getPlaylist,
    read: ({ id, body }) => bare({ name: CALL_NAMES.getPlaylist, playlistId: id })({ body }),
  }),
  numbered({
    route: ROUTES.getAccountMediaTicket,
    read: ({ id, body }) => bare({ name: CALL_NAMES.getAccountTicket, mediaId: id })({ body }),
  }),
  {
    kind: ROUTE_KINDS.fixed,
    method: ROUTES.getMediaOrigins.method,
    path: ROUTES.getMediaOrigins.path,
    read: bare({ name: CALL_NAMES.getMediaOrigins }),
  },
]

type IdOfProps = { pattern: RegExp; path: string }

/** The id a numbered route captured, when it is an id written the one way it can be. */
const idOf = ({ pattern, path }: IdOfProps): number | null => {
  const digits = pattern.exec(path)?.[1] ?? null
  if (digits === null) return null
  const id = Number(digits)
  return isMediaId(id) && String(id) === digits ? id : null
}

type MatchRouteProps = {
  route: Route
  path: string
  body: Body
}

const matchRoute = ({ route, path, body }: MatchRouteProps): AllowedCall | null => {
  switch (route.kind) {
    case ROUTE_KINDS.fixed:
      return route.path === path ? route.read({ body }) : null
    case ROUTE_KINDS.numbered: {
      const id = idOf({ pattern: route.pattern, path })
      return id === null ? null : route.read({ id, body })
    }
    default: {
      const unreachable: never = route
      return unreachable
    }
  }
}

type MatchCallProps = {
  method: string
  path: string
  body: string | null
}

/**
 * One of the allowlisted calls, read from its request, or null for anything else. Main reads back
 * each request it built, so a value that slipped past the types never reaches a path.
 */
export const matchCall = ({ method, path, body }: MatchCallProps): AllowedCall | null => {
  const read = readBody(body)
  if (read.kind === BODY_KINDS.bad) return null
  return ALLOWED_ROUTES.reduce<AllowedCall | null>(
    (found, route) =>
      found ?? (route.method === method ? matchRoute({ route, path, body: read }) : null),
    null,
  )
}

/** The request main sends for a call, built from its fields alone. */
export const requestFor = (call: AllowedCall): AllowedRequest => {
  switch (call.name) {
    case CALL_NAMES.getMedia:
      return bareRequest({ route: ROUTES.getMedia, id: call.mediaId })
    case CALL_NAMES.getTracks:
      return bareRequest({ route: ROUTES.getTracks, id: call.mediaId })
    case CALL_NAMES.saveProgress:
      return {
        method: ROUTES.saveProgress.method,
        path: pathFor({
          path: ROUTES.saveProgress.path,
          params: { [AUTH_PARAMS.id]: call.mediaId },
        }),
        body: JSON.stringify({ position: call.position, audio: call.audio }),
      }
    case CALL_NAMES.recordPlay:
      return bareRequest({ route: ROUTES.recordPlay, id: call.mediaId })
    case CALL_NAMES.getItem:
      return bareRequest({ route: ROUTES.getItem, id: call.itemId })
    case CALL_NAMES.getLibrary:
      return bareRequest({ route: ROUTES.getLibrary, id: call.libraryId })
    case CALL_NAMES.getSagas:
      return bareRequest({ route: ROUTES.listSagas, id: call.libraryId })
    case CALL_NAMES.getAlbum:
      return bareRequest({ route: ROUTES.getAlbum, id: call.albumId })
    case CALL_NAMES.getPlaylist:
      return bareRequest({ route: ROUTES.getPlaylist, id: call.playlistId })
    case CALL_NAMES.getMediaOrigins:
      return {
        method: ROUTES.getMediaOrigins.method,
        path: ROUTES.getMediaOrigins.path,
        body: null,
      }
    case CALL_NAMES.getAccountTicket:
      return bareRequest({ route: ROUTES.getAccountMediaTicket, id: call.mediaId })
    default: {
      const unreachable: never = call
      return unreachable
    }
  }
}

/** Whether a call changes what the server holds, so quitting waits for it. */
export const isWrite = (call: AllowedCall): boolean => {
  switch (call.name) {
    case CALL_NAMES.saveProgress:
    case CALL_NAMES.recordPlay:
      return true
    case CALL_NAMES.getMedia:
    case CALL_NAMES.getTracks:
    case CALL_NAMES.getItem:
    case CALL_NAMES.getLibrary:
    case CALL_NAMES.getSagas:
    case CALL_NAMES.getAlbum:
    case CALL_NAMES.getPlaylist:
    case CALL_NAMES.getMediaOrigins:
    case CALL_NAMES.getAccountTicket:
      return false
    default: {
      const unreachable: never = call
      return unreachable
    }
  }
}
