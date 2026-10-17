import { isMediaOriginKind, type MediaOrigin } from '@raven/core'

export const MEDIA_PLANE_ENV = {
  origins: 'RAVEN_MEDIA_ORIGINS',
  webOrigins: 'RAVEN_WEB_ORIGINS',
  secret: 'RAVEN_MEDIA_SECRET',
} as const

/** Tickets are signed with 32 random bytes at least; a shorter key is brute-forceable. */
const MIN_SECRET_BYTES = 32

export type MediaPlaneConfig = {
  /** Where the browser may fetch media from, best first; empty without a usable secret. */
  origins: MediaOrigin[]
  /** Origins allowed to call the media routes cross-origin; a pattern may hold a `*`. */
  webOrigins: string[]
  /** The key tickets are signed with; null when unset or unusable. Never logged or sent to a client. */
  secret: Buffer | null
  /** One sentence per entry or value that was dropped, for the boot log. */
  problems: string[]
}

const splitList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')

/** `scheme`, `host` (lower case) and `port` (null for the scheme's default) of an origin with no path, or null. */
const splitOrigin = (
  value: string,
): { scheme: 'http' | 'https'; host: string; port: string | null } | null => {
  const match = /^(https?):\/\/([^/?#:@\s]+)(?::(\d{1,5}))?$/i.exec(value.replace(/\/+$/, ''))
  const scheme = match?.[1]?.toLowerCase()
  const host = match?.[2]?.toLowerCase()
  if (!match || host === undefined || (scheme !== 'http' && scheme !== 'https')) return null
  const port = match[3] ?? null
  const isDefaultPort = port === (scheme === 'https' ? '443' : '80')
  return { scheme, host, port: isDefaultPort ? null : port }
}

/** The origin in its canonical form (lower case host, default port gone), or null for a path, query, fragment or login. */
const normalisedOrigin = (value: string): string | null => {
  if (!URL.canParse(value)) return null
  const url = new URL(value)
  const isBare =
    /^\/*$/.test(url.pathname) &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === ''
  const isAllowedScheme =
    url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost')
  return isBare && isAllowedScheme ? url.origin : null
}

const originProblem = (entry: string): string =>
  `${MEDIA_PLANE_ENV.origins} entry "${entry}" is not an https origin with no path, query or fragment (http is for localhost only).`

const parseMediaOrigin = (
  entry: string,
): { origin: MediaOrigin | null; problem: string | null } => {
  const colon = entry.indexOf(':')
  const kind = colon < 0 ? '' : entry.slice(0, colon).trim()
  const url = colon < 0 ? '' : entry.slice(colon + 1).trim()
  if (!isMediaOriginKind(kind) || url === '') {
    return {
      origin: null,
      problem: `${MEDIA_PLANE_ENV.origins} entry "${entry}" has an unknown kind; use lan, tailnet or public.`,
    }
  }
  const origin = normalisedOrigin(url)
  if (origin === null) return { origin: null, problem: originProblem(entry) }
  return { origin: { kind, url: origin }, problem: null }
}

/** `kind:url` entries, comma separated and best first; an entry that is not valid is dropped and named. */
export const parseMediaOrigins = (
  value: string | undefined,
): { origins: MediaOrigin[]; problems: string[] } => {
  const parsed = splitList(value).map(parseMediaOrigin)
  return {
    origins: parsed.flatMap(({ origin }) => (origin ? [origin] : [])),
    problems: parsed.flatMap(({ problem }) => (problem ? [problem] : [])),
  }
}

/**
 * At most one `*`, and only in the first label, where it can sit anywhere.
 * A star in a later label would let a stranger's hostname in.
 */
const hasValidWildcard = (host: string): boolean => {
  const [first = '', ...rest] = host.split('.')
  if (rest.some((label) => label.includes('*'))) return false
  return first.split('*').length <= 2
}

const webOriginProblem = (entry: string): string =>
  `${MEDIA_PLANE_ENV.webOrigins} entry "${entry}" is not an https origin with no path (http is for localhost only). A * is allowed once, in the first hostname label only, anywhere in it, and stands for one or more characters other than a dot.`

const parseWebOrigin = (entry: string): string | null => {
  const parts = splitOrigin(entry)
  if (!parts || !hasValidWildcard(parts.host)) return null
  if (parts.scheme === 'http' && parts.host !== 'localhost') return null
  return `${parts.scheme}://${parts.host}${parts.port ? `:${parts.port}` : ''}`
}

/** Exact https origins, `http://localhost`, and https hosts whose first label holds a `*`. */
export const parseWebOrigins = (
  value: string | undefined,
): { origins: string[]; problems: string[] } => {
  const parsed = splitList(value).map((entry) => ({ entry, origin: parseWebOrigin(entry) }))
  return {
    origins: parsed.flatMap(({ origin }) => (origin === null ? [] : [origin])),
    problems: parsed.flatMap(({ entry, origin }) =>
      origin === null ? [webOriginProblem(entry)] : [],
    ),
  }
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `*` stands for one or more characters of a single label, never a `.`. */
const wildcardLabel = (label: string): RegExp =>
  new RegExp(`^${label.split('*').map(escapeRegExp).join('[^.]+')}$`)

const matchesPattern = ({
  origin,
  pattern,
}: {
  origin: NonNullable<ReturnType<typeof splitOrigin>>
  pattern: NonNullable<ReturnType<typeof splitOrigin>>
}): boolean => {
  if (origin.scheme !== pattern.scheme || origin.port !== pattern.port) return false
  const originLabels = origin.host.split('.')
  const patternLabels = pattern.host.split('.')
  if (originLabels.length !== patternLabels.length) return false
  return patternLabels.every((label, index) => wildcardLabel(label).test(originLabels[index] ?? ''))
}

/** Whether a request's `Origin` header is one of `allowed` (as `parseWebOrigins` returns them). */
export const isAllowedWebOrigin = ({
  origin,
  allowed,
}: {
  origin: string | undefined
  allowed: readonly string[]
}): boolean => {
  const requested = origin ? splitOrigin(origin) : null
  if (!requested || requested.host.includes('*')) return false
  return allowed.some((entry) => {
    const pattern = splitOrigin(entry)
    return !!pattern && matchesPattern({ origin: requested, pattern })
  })
}

const toBase64 = (value: string): string =>
  value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')

/** Standard or url-safe base64 of 32 bytes or more; the problem never holds the value. */
export const readMediaSecret = (
  value: string | undefined,
): { secret: Buffer | null; problems: string[] } => {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') {
    return { secret: null, problems: [`${MEDIA_PLANE_ENV.secret} is not set.`] }
  }
  const secret = Buffer.from(trimmed, 'base64')
  // Buffer.from skips what is not base64, so a lossy round trip means the text was not base64.
  if (secret.toString('base64').replace(/=+$/, '') !== toBase64(trimmed)) {
    return { secret: null, problems: [`${MEDIA_PLANE_ENV.secret} is not base64.`] }
  }
  if (secret.length < MIN_SECRET_BYTES) {
    return {
      secret: null,
      problems: [
        `${MEDIA_PLANE_ENV.secret} decodes to ${secret.length} bytes; it needs ${MIN_SECRET_BYTES} or more.`,
      ],
    }
  }
  return { secret, problems: [] }
}

export const readMediaPlaneConfig = (env: NodeJS.ProcessEnv): MediaPlaneConfig => {
  const origins = parseMediaOrigins(env[MEDIA_PLANE_ENV.origins])
  const webOrigins = parseWebOrigins(env[MEDIA_PLANE_ENV.webOrigins])
  const secret = readMediaSecret(env[MEDIA_PLANE_ENV.secret])
  const hasSecretValue = (env[MEDIA_PLANE_ENV.secret]?.trim() ?? '') !== ''
  const needsSecret = origins.origins.length > 0 || hasSecretValue
  const isUsable = secret.secret !== null
  return {
    origins: isUsable ? origins.origins : [],
    webOrigins: webOrigins.origins,
    secret: secret.secret,
    problems: [
      ...origins.problems,
      ...webOrigins.problems,
      ...(needsSecret ? secret.problems : []),
    ],
  }
}
