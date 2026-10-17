import { isAdminUnlockRequest, isMediaId, isProgressChange, isUnlockRequest } from '@raven/core'

export const SERVER_METHODS = ['GET', 'PUT', 'POST'] as const
export type ServerMethod = (typeof SERVER_METHODS)[number]
export const MAX_BODY = 4096
export const MAX_SECRET = 256

export type AllowedCall =
  | { name: 'getMedia'; mediaId: number }
  | { name: 'getTracks'; mediaId: number }
  | { name: 'saveProgress'; mediaId: number; position: number }
  | { name: 'recordPlay'; mediaId: number }
  | { name: 'getLock' }
  | { name: 'unlock'; pin: string }
  | { name: 'getAdminLock' }
  | { name: 'unlockAdmin'; password: string }
  | { name: 'getItem'; itemId: number }
  | { name: 'getLibrary'; libraryId: number }
  | { name: 'getSagas'; libraryId: number }
  | { name: 'getMediaOrigins' }
  | { name: 'getMediaTicket'; mediaId: number }

type Body = { kind: 'none' } | { kind: 'json'; value: unknown } | { kind: 'bad' }

type Route =
  | {
      kind: 'numbered'
      method: ServerMethod
      pattern: RegExp
      read: (input: { id: number; body: Body }) => AllowedCall | null
    }
  | {
      kind: 'fixed'
      method: ServerMethod
      path: string
      read: (input: { body: Body }) => AllowedCall | null
    }

const NONE = { kind: 'none' } as const satisfies Body

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
    kind: 'numbered',
    method: 'GET',
    pattern: /^\/api\/media\/([1-9]\d{0,15})$/u,
    read: ({ id, body }) => bare({ name: 'getMedia', mediaId: id })({ body }),
  },
  {
    kind: 'numbered',
    method: 'GET',
    pattern: /^\/api\/media\/([1-9]\d{0,15})\/tracks$/u,
    read: ({ id, body }) => bare({ name: 'getTracks', mediaId: id })({ body }),
  },
  {
    kind: 'numbered',
    method: 'PUT',
    pattern: /^\/api\/media\/([1-9]\d{0,15})\/progress$/u,
    read: ({ id, body }) =>
      body.kind === 'json' && isProgressChange(body.value)
        ? { name: 'saveProgress', mediaId: id, position: body.value.position }
        : null,
  },
  {
    kind: 'numbered',
    method: 'POST',
    pattern: /^\/api\/media\/([1-9]\d{0,15})\/plays$/u,
    read: ({ id, body }) => bare({ name: 'recordPlay', mediaId: id })({ body }),
  },
  {
    kind: 'numbered',
    method: 'GET',
    pattern: /^\/api\/items\/([1-9]\d{0,15})$/u,
    read: ({ id, body }) => bare({ name: 'getItem', itemId: id })({ body }),
  },
  {
    kind: 'numbered',
    method: 'GET',
    pattern: /^\/api\/libraries\/([1-9]\d{0,15})$/u,
    read: ({ id, body }) => bare({ name: 'getLibrary', libraryId: id })({ body }),
  },
  {
    kind: 'numbered',
    method: 'GET',
    pattern: /^\/api\/libraries\/([1-9]\d{0,15})\/sagas$/u,
    read: ({ id, body }) => bare({ name: 'getSagas', libraryId: id })({ body }),
  },
  {
    kind: 'numbered',
    method: 'GET',
    pattern: /^\/api\/media\/([1-9]\d{0,15})\/ticket$/u,
    read: ({ id, body }) => bare({ name: 'getMediaTicket', mediaId: id })({ body }),
  },
  {
    kind: 'fixed',
    method: 'GET',
    path: '/api/media-origins',
    read: bare({ name: 'getMediaOrigins' }),
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
    case 'fixed':
      return route.path === path ? route.read({ body }) : null
    case 'numbered': {
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
    case 'getItem':
      return { method: 'GET', path: `/api/items/${call.itemId}`, body: null }
    case 'getLibrary':
      return { method: 'GET', path: `/api/libraries/${call.libraryId}`, body: null }
    case 'getSagas':
      return { method: 'GET', path: `/api/libraries/${call.libraryId}/sagas`, body: null }
    case 'getMediaOrigins':
      return { method: 'GET', path: '/api/media-origins', body: null }
    case 'getMediaTicket':
      return { method: 'GET', path: `/api/media/${call.mediaId}/ticket`, body: null }
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
    case 'getItem':
    case 'getLibrary':
    case 'getSagas':
    case 'getMediaOrigins':
    case 'getMediaTicket':
      return false
    default: {
      const unreachable: never = call
      return unreachable
    }
  }
}
