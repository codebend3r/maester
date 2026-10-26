import {
  AUTH_PARAMS,
  AUTH_PATHS,
  isMediaId,
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
  | { name: typeof CALL_NAMES.getMediaOrigins }
  | { name: typeof CALL_NAMES.getAccountTicket; mediaId: number }

/** The fixed paths among the calls; the numbered calls' paths carry an id. */
export const API_PATHS = {
  mediaOrigins: '/api/media-origins',
  media: '/api/media',
} as const

/** A title's bytes under `${API_PATHS.media}/<id>/`, read with a ticket or a cookie. */
export const MEDIA_FILE_PATH = 'file'
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

type WithIdProps = { path: string; id: string }

/** An account route's path with its `:id` filled in. */
const withId = ({ path, id }: WithIdProps): string => path.replace(ID_PARAM, id)

type BareCallbackProps = { body: Body }

/** Only for the calls that take no body: anything sent along refuses the call. */
const bare =
  (call: AllowedCall) =>
  ({ body }: BareCallbackProps): AllowedCall | null =>
    body.kind === BODY_KINDS.none ? call : null

// Matched on the whole string, digits only, so no query, fragment, dot segment,
// escape, extra slash or absolute URL can match; `$` without the `m` flag ends the input.
const ROUTES: readonly Route[] = [
  {
    kind: ROUTE_KINDS.numbered,
    method: SERVER_METHODS.get,
    pattern: /^\/api\/media\/([1-9]\d{0,15})$/u,
    read: ({ id, body }) => bare({ name: CALL_NAMES.getMedia, mediaId: id })({ body }),
  },
  {
    kind: ROUTE_KINDS.numbered,
    method: SERVER_METHODS.get,
    pattern: /^\/api\/media\/([1-9]\d{0,15})\/tracks$/u,
    read: ({ id, body }) => bare({ name: CALL_NAMES.getTracks, mediaId: id })({ body }),
  },
  {
    kind: ROUTE_KINDS.numbered,
    method: SERVER_METHODS.put,
    pattern: /^\/api\/media\/([1-9]\d{0,15})\/progress$/u,
    read: ({ id, body }) => {
      if (body.kind !== BODY_KINDS.json || !isProgressChange(body.value)) return null
      // An older page names no audio track; null tells the server it cannot tell.
      const audio = isProgressReport(body.value) ? body.value.audio : null
      return { name: CALL_NAMES.saveProgress, mediaId: id, position: body.value.position, audio }
    },
  },
  {
    kind: ROUTE_KINDS.numbered,
    method: SERVER_METHODS.post,
    pattern: /^\/api\/media\/([1-9]\d{0,15})\/plays$/u,
    read: ({ id, body }) => bare({ name: CALL_NAMES.recordPlay, mediaId: id })({ body }),
  },
  {
    kind: ROUTE_KINDS.numbered,
    method: SERVER_METHODS.get,
    pattern: /^\/api\/items\/([1-9]\d{0,15})$/u,
    read: ({ id, body }) => bare({ name: CALL_NAMES.getItem, itemId: id })({ body }),
  },
  {
    kind: ROUTE_KINDS.numbered,
    method: SERVER_METHODS.get,
    pattern: /^\/api\/libraries\/([1-9]\d{0,15})$/u,
    read: ({ id, body }) => bare({ name: CALL_NAMES.getLibrary, libraryId: id })({ body }),
  },
  {
    kind: ROUTE_KINDS.numbered,
    method: SERVER_METHODS.get,
    pattern: /^\/api\/libraries\/([1-9]\d{0,15})\/sagas$/u,
    read: ({ id, body }) => bare({ name: CALL_NAMES.getSagas, libraryId: id })({ body }),
  },
  {
    kind: ROUTE_KINDS.numbered,
    method: SERVER_METHODS.post,
    pattern: new RegExp(`^${withId({ path: AUTH_PATHS.ticket, id: '([1-9]\\d{0,15})' })}$`, 'u'),
    read: ({ id, body }) => bare({ name: CALL_NAMES.getAccountTicket, mediaId: id })({ body }),
  },
  {
    kind: ROUTE_KINDS.fixed,
    method: SERVER_METHODS.get,
    path: API_PATHS.mediaOrigins,
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
  return ROUTES.reduce<AllowedCall | null>(
    (found, route) =>
      found ?? (route.method === method ? matchRoute({ route, path, body: read }) : null),
    null,
  )
}

/** The request main sends for a call, built from its fields alone. */
export const requestFor = (
  call: AllowedCall,
): { method: ServerMethod; path: string; body: string | null } => {
  switch (call.name) {
    case CALL_NAMES.getMedia:
      return { method: SERVER_METHODS.get, path: `/api/media/${call.mediaId}`, body: null }
    case CALL_NAMES.getTracks:
      return { method: SERVER_METHODS.get, path: `/api/media/${call.mediaId}/tracks`, body: null }
    case CALL_NAMES.saveProgress:
      return {
        method: SERVER_METHODS.put,
        path: `/api/media/${call.mediaId}/progress`,
        body: JSON.stringify({ position: call.position, audio: call.audio }),
      }
    case CALL_NAMES.recordPlay:
      return { method: SERVER_METHODS.post, path: `/api/media/${call.mediaId}/plays`, body: null }
    case CALL_NAMES.getItem:
      return { method: SERVER_METHODS.get, path: `/api/items/${call.itemId}`, body: null }
    case CALL_NAMES.getLibrary:
      return { method: SERVER_METHODS.get, path: `/api/libraries/${call.libraryId}`, body: null }
    case CALL_NAMES.getSagas:
      return {
        method: SERVER_METHODS.get,
        path: `/api/libraries/${call.libraryId}/sagas`,
        body: null,
      }
    case CALL_NAMES.getMediaOrigins:
      return { method: SERVER_METHODS.get, path: API_PATHS.mediaOrigins, body: null }
    case CALL_NAMES.getAccountTicket:
      return {
        method: SERVER_METHODS.post,
        path: withId({ path: AUTH_PATHS.ticket, id: String(call.mediaId) }),
        body: null,
      }
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
    case CALL_NAMES.getMediaOrigins:
    case CALL_NAMES.getAccountTicket:
      return false
    default: {
      const unreachable: never = call
      return unreachable
    }
  }
}
