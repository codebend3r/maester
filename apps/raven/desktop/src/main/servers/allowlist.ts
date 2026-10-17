import { isAdminUnlockRequest, isMediaId, isProgressChange, isUnlockRequest } from '@raven/core'

export const SERVER_METHODS = ['GET', 'PUT', 'POST'] as const
export type ServerMethod = (typeof SERVER_METHODS)[number]
export const MAX_BODY = 4096
export const MAX_SECRET = 256

/** The eight calls main makes for the page, by name. */
export const CALL_NAMES = {
  getMedia: 'getMedia',
  getTracks: 'getTracks',
  saveProgress: 'saveProgress',
  recordPlay: 'recordPlay',
  getLock: 'getLock',
  unlock: 'unlock',
  getAdminLock: 'getAdminLock',
  unlockAdmin: 'unlockAdmin',
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

/** The fixed paths among the calls; the media calls' paths carry the media id. */
export const API_PATHS = {
  lock: '/api/lock',
  unlock: '/api/lock/unlock',
  admin: '/api/admin',
  adminUnlock: '/api/admin/unlock',
} as const

const BODY_KINDS = { none: 'none', json: 'json', bad: 'bad' } as const

type Body =
  | { kind: typeof BODY_KINDS.none }
  | { kind: typeof BODY_KINDS.json; value: unknown }
  | { kind: typeof BODY_KINDS.bad }

const ROUTE_KINDS = { media: 'media', fixed: 'fixed' } as const

type Route =
  | {
      kind: 'media'
      method: ServerMethod
      pattern: RegExp
      read: (input: { mediaId: number; body: Body }) => AllowedCall | null
    }
  | {
      kind: 'fixed'
      method: ServerMethod
      path: string
      read: (input: { body: Body }) => AllowedCall | null
    }

const NONE = { kind: BODY_KINDS.none } as const satisfies Body

const readBody = (body: string | null): Body => {
  if (body === null) return NONE
  if (body.length > MAX_BODY) return { kind: 'bad' }
  try {
    const value: unknown = JSON.parse(body)
    return { kind: 'json', value }
  } catch {
    return { kind: 'bad' }
  }
}

const isSecret = (value: string): boolean => value.length <= MAX_SECRET

/** Only for the calls that take no body: anything sent along refuses the call. */
const bare =
  (call: AllowedCall) =>
  ({ body }: { body: Body }): AllowedCall | null =>
    body.kind === 'none' ? call : null

// Matched on the whole string, digits only, so no query, fragment, dot segment,
// escape, extra slash or absolute URL can match; `$` without the `m` flag ends the input.
const ROUTES: readonly Route[] = [
  {
    kind: 'media',
    method: 'GET',
    pattern: /^\/api\/media\/([1-9]\d{0,15})$/u,
    read: ({ mediaId, body }) => bare({ name: 'getMedia', mediaId })({ body }),
  },
  {
    kind: 'media',
    method: 'GET',
    pattern: /^\/api\/media\/([1-9]\d{0,15})\/tracks$/u,
    read: ({ mediaId, body }) => bare({ name: 'getTracks', mediaId })({ body }),
  },
  {
    kind: 'media',
    method: 'PUT',
    pattern: /^\/api\/media\/([1-9]\d{0,15})\/progress$/u,
    read: ({ mediaId, body }) =>
      body.kind === 'json' && isProgressChange(body.value)
        ? { name: 'saveProgress', mediaId, position: body.value.position }
        : null,
  },
  {
    kind: 'media',
    method: 'POST',
    pattern: /^\/api\/media\/([1-9]\d{0,15})\/plays$/u,
    read: ({ mediaId, body }) => bare({ name: 'recordPlay', mediaId })({ body }),
  },
  { kind: 'fixed', method: 'GET', path: '/api/lock', read: bare({ name: 'getLock' }) },
  {
    kind: 'fixed',
    method: 'POST',
    path: '/api/lock/unlock',
    read: ({ body }) =>
      body.kind === 'json' && isUnlockRequest(body.value) && isSecret(body.value.pin)
        ? { name: 'unlock', pin: body.value.pin }
        : null,
  },
  { kind: 'fixed', method: 'GET', path: '/api/admin', read: bare({ name: 'getAdminLock' }) },
  {
    kind: 'fixed',
    method: 'POST',
    path: '/api/admin/unlock',
    read: ({ body }) =>
      body.kind === 'json' && isAdminUnlockRequest(body.value) && isSecret(body.value.password)
        ? { name: 'unlockAdmin', password: body.value.password }
        : null,
  },
]

/** The id a media route captured, when it is a media id written the one way it can be. */
const mediaIdOf = ({ pattern, path }: { pattern: RegExp; path: string }): number | null => {
  const digits = pattern.exec(path)?.[1] ?? null
  if (digits === null) return null
  const mediaId = Number(digits)
  return isMediaId(mediaId) && String(mediaId) === digits ? mediaId : null
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
    case 'fixed':
      return route.path === path ? route.read({ body }) : null
    case 'media': {
      const mediaId = mediaIdOf({ pattern: route.pattern, path })
      return mediaId === null ? null : route.read({ mediaId, body })
    }
    default: {
      const unreachable: never = route
      return unreachable
    }
  }
}

/** One of the eight calls the page may make, read from what it sent, or null for anything else. */
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
  if (read.kind === 'bad') return null
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
    case 'getMedia':
      return { method: 'GET', path: `/api/media/${call.mediaId}`, body: null }
    case 'getTracks':
      return { method: 'GET', path: `/api/media/${call.mediaId}/tracks`, body: null }
    case 'saveProgress':
      return {
        method: 'PUT',
        path: `/api/media/${call.mediaId}/progress`,
        body: JSON.stringify({ position: call.position }),
      }
    case 'recordPlay':
      return { method: 'POST', path: `/api/media/${call.mediaId}/plays`, body: null }
    case 'getLock':
      return { method: 'GET', path: '/api/lock', body: null }
    case 'unlock':
      return { method: 'POST', path: '/api/lock/unlock', body: JSON.stringify({ pin: call.pin }) }
    case 'getAdminLock':
      return { method: 'GET', path: '/api/admin', body: null }
    case 'unlockAdmin':
      return {
        method: 'POST',
        path: '/api/admin/unlock',
        body: JSON.stringify({ password: call.password }),
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
    case 'saveProgress':
    case 'recordPlay':
      return true
    case 'getMedia':
    case 'getTracks':
    case 'getLock':
    case 'unlock':
    case 'getAdminLock':
    case 'unlockAdmin':
      return false
    default: {
      const unreachable: never = call
      return unreachable
    }
  }
}
