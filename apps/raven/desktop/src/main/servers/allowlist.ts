import { isAdminUnlockRequest, isMediaId, isProgressChange, isUnlockRequest } from '@raven/core'
import { SERVER_METHODS } from '@/shared/protocol'

export type ServerMethod = (typeof SERVER_METHODS)[keyof typeof SERVER_METHODS]
export const MAX_BODY = 4096
export const MAX_SECRET = 256

/** The calls main makes for the page, by name. */
export const CALL_NAMES = {
  getMedia: 'getMedia',
  getTracks: 'getTracks',
  saveProgress: 'saveProgress',
  recordPlay: 'recordPlay',
  getLock: 'getLock',
  unlock: 'unlock',
  getAdminLock: 'getAdminLock',
  unlockAdmin: 'unlockAdmin',
  getItem: 'getItem',
  getLibrary: 'getLibrary',
  getSagas: 'getSagas',
  getMediaOrigins: 'getMediaOrigins',
  getMediaTicket: 'getMediaTicket',
} as const

export type AllowedCall =
  | { name: typeof CALL_NAMES.getMedia; mediaId: number }
  | { name: typeof CALL_NAMES.getTracks; mediaId: number }
  | { name: typeof CALL_NAMES.saveProgress; mediaId: number; position: number }
  | { name: typeof CALL_NAMES.recordPlay; mediaId: number }
  | { name: typeof CALL_NAMES.getLock }
  | { name: typeof CALL_NAMES.unlock; pin: string }
  | { name: typeof CALL_NAMES.getAdminLock }
  | { name: typeof CALL_NAMES.unlockAdmin; password: string }
  | { name: typeof CALL_NAMES.getItem; itemId: number }
  | { name: typeof CALL_NAMES.getLibrary; libraryId: number }
  | { name: typeof CALL_NAMES.getSagas; libraryId: number }
  | { name: typeof CALL_NAMES.getMediaOrigins }
  | { name: typeof CALL_NAMES.getMediaTicket; mediaId: number }

/** The fixed paths among the calls; the numbered calls' paths carry an id. */
export const API_PATHS = {
  lock: '/api/lock',
  unlock: '/api/lock/unlock',
  admin: '/api/admin',
  adminUnlock: '/api/admin/unlock',
  mediaOrigins: '/api/media-origins',
} as const

const BODY_KINDS = { none: 'none', json: 'json', bad: 'bad' } as const

type Body =
  | { kind: typeof BODY_KINDS.none }
  | { kind: typeof BODY_KINDS.json; value: unknown }
  | { kind: typeof BODY_KINDS.bad }

const ROUTE_KINDS = { numbered: 'numbered', fixed: 'fixed' } as const

type Route =
  | {
      kind: typeof ROUTE_KINDS.numbered
      method: ServerMethod
      pattern: RegExp
      read: (input: { id: number; body: Body }) => AllowedCall | null
    }
  | {
      kind: typeof ROUTE_KINDS.fixed
      method: ServerMethod
      path: string
      read: (input: { body: Body }) => AllowedCall | null
    }

const NONE = { kind: BODY_KINDS.none } as const satisfies Body

const readBody = (body: string | null): Body => {
  if (body === null) return NONE
  if (body.length > MAX_BODY) return { kind: BODY_KINDS.bad }
  try {
    const value: unknown = JSON.parse(body)
    return { kind: BODY_KINDS.json, value }
  } catch {
    return { kind: BODY_KINDS.bad }
  }
}

const isSecret = (value: string): boolean => value.length <= MAX_SECRET

/** Only for the calls that take no body: anything sent along refuses the call. */
const bare =
  (call: AllowedCall) =>
  ({ body }: { body: Body }): AllowedCall | null =>
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
    read: ({ id, body }) =>
      body.kind === BODY_KINDS.json && isProgressChange(body.value)
        ? { name: CALL_NAMES.saveProgress, mediaId: id, position: body.value.position }
        : null,
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
    method: SERVER_METHODS.get,
    pattern: /^\/api\/media\/([1-9]\d{0,15})\/ticket$/u,
    read: ({ id, body }) => bare({ name: CALL_NAMES.getMediaTicket, mediaId: id })({ body }),
  },
  {
    kind: ROUTE_KINDS.fixed,
    method: SERVER_METHODS.get,
    path: API_PATHS.mediaOrigins,
    read: bare({ name: CALL_NAMES.getMediaOrigins }),
  },
  {
    kind: ROUTE_KINDS.fixed,
    method: SERVER_METHODS.get,
    path: API_PATHS.lock,
    read: bare({ name: CALL_NAMES.getLock }),
  },
  {
    kind: ROUTE_KINDS.fixed,
    method: SERVER_METHODS.post,
    path: API_PATHS.unlock,
    read: ({ body }) =>
      body.kind === BODY_KINDS.json && isUnlockRequest(body.value) && isSecret(body.value.pin)
        ? { name: CALL_NAMES.unlock, pin: body.value.pin }
        : null,
  },
  {
    kind: ROUTE_KINDS.fixed,
    method: SERVER_METHODS.get,
    path: API_PATHS.admin,
    read: bare({ name: CALL_NAMES.getAdminLock }),
  },
  {
    kind: ROUTE_KINDS.fixed,
    method: SERVER_METHODS.post,
    path: API_PATHS.adminUnlock,
    read: ({ body }) =>
      body.kind === BODY_KINDS.json &&
      isAdminUnlockRequest(body.value) &&
      isSecret(body.value.password)
        ? { name: CALL_NAMES.unlockAdmin, password: body.value.password }
        : null,
  },
]

/** The id a numbered route captured, when it is an id written the one way it can be. */
const idOf = ({ pattern, path }: { pattern: RegExp; path: string }): number | null => {
  const digits = pattern.exec(path)?.[1] ?? null
  if (digits === null) return null
  const id = Number(digits)
  return isMediaId(id) && String(id) === digits ? id : null
}

const matchRoute = ({
  route,
  path,
  body,
}: {
  route: Route
  path: string
  body: Body
}): AllowedCall | null => {
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

/** One of the thirteen calls the page may make, read from what it sent, or null for anything else. */
export const matchCall = ({
  method,
  path,
  body,
}: {
  method: string
  path: string
  body: string | null
}): AllowedCall | null => {
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
        body: JSON.stringify({ position: call.position }),
      }
    case CALL_NAMES.recordPlay:
      return { method: SERVER_METHODS.post, path: `/api/media/${call.mediaId}/plays`, body: null }
    case CALL_NAMES.getLock:
      return { method: SERVER_METHODS.get, path: API_PATHS.lock, body: null }
    case CALL_NAMES.unlock:
      return {
        method: SERVER_METHODS.post,
        path: API_PATHS.unlock,
        body: JSON.stringify({ pin: call.pin }),
      }
    case CALL_NAMES.getAdminLock:
      return { method: SERVER_METHODS.get, path: API_PATHS.admin, body: null }
    case CALL_NAMES.unlockAdmin:
      return {
        method: SERVER_METHODS.post,
        path: API_PATHS.adminUnlock,
        body: JSON.stringify({ password: call.password }),
      }
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
    case CALL_NAMES.getMediaTicket:
      return { method: SERVER_METHODS.get, path: `/api/media/${call.mediaId}/ticket`, body: null }
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
    case CALL_NAMES.getLock:
    case CALL_NAMES.unlock:
    case CALL_NAMES.getAdminLock:
    case CALL_NAMES.unlockAdmin:
    case CALL_NAMES.getItem:
    case CALL_NAMES.getLibrary:
    case CALL_NAMES.getSagas:
    case CALL_NAMES.getMediaOrigins:
    case CALL_NAMES.getMediaTicket:
      return false
    default: {
      const unreachable: never = call
      return unreachable
    }
  }
}
