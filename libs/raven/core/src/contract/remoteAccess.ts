import { isStreamQuality } from '@/contract/streaming'
import { fromQueryString, toQueryString } from '@/query'
import {
  type Infer,
  exactPartial,
  isBoolean,
  isNumber,
  isString,
  listOf,
  matching,
  nullable,
  object,
  oneOf,
  union,
  wholeNumberIn,
  literal,
} from '@/schema'

/** The routes Remote Access answers on: the owner's settings and status, and the echo the outside check reaches. */
export const REMOTE_ACCESS_PATHS = {
  settings: '/api/remote-access',
  echo: '/api/remote-access/echo/:nonce',
} as const

/** The placeholder in `REMOTE_ACCESS_PATHS.echo`. */
export const REMOTE_ACCESS_PARAMS = { nonce: 'nonce' } as const

/** Where the web app's site answers the reachability check, from outside the home network. */
export const REACHABILITY_CHECK_PATH = '/remote-access/check'

/** The query keys of the reachability check. */
export const REACHABILITY_PARAMS = {
  host: 'host',
  port: 'port',
  nonce: 'nonce',
  signature: 'signature',
} as const

/**
 * How long each side of a reachability check waits: the function for raven's
 * echo, raven for the function (the function's wait and then some), and how
 * long a check's nonce opens the echo (raven's wait and then some).
 */
export const REACHABILITY_TIMINGS = {
  targetTimeoutMs: 8_000,
  checkTimeoutMs: 15_000,
  nonceMs: 30_000,
} as const

/** The numbers a TCP port can be. */
export const PORT_RANGE = { min: 1, max: 65_535 } as const

/** The port an https origin leaves unsaid. */
export const HTTPS_PORT = 443

export const isPort = wholeNumberIn(PORT_RANGE)

/** The most an upload speed can be, in megabits a second: a 100 gigabit line. */
export const MAX_UPLOAD_MBPS = 100_000

/** An upload speed in megabits a second: more than none, and no more than any line carries. */
export const isUploadMbps = (value: unknown): value is number =>
  isNumber(value) && value > 0 && value <= MAX_UPLOAD_MBPS

/**
 * A DNS name of two labels or more, in lower case, whose last label starts
 * with a letter, so an IP address never passes: a certificate names a host.
 */
export const isPublicHostname = matching(
  /^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
)

/** The limit that holds no remote stream back. */
export const REMOTE_LIMITS = { original: 'original' } as const

/** `original`, or the size a remote transcode is held to. */
export const isRemoteLimit = oneOf([REMOTE_LIMITS.original, ...isStreamQuality.values])

export type RemoteLimit = Infer<typeof isRemoteLimit>

/** How raven is reached from outside the home network, set by the owner in Admin. */
export const isRemoteAccessSettings = object({
  /** Whether raven offers its public origin at all. */
  isEnabled: isBoolean,
  /** The name the certificate is for, such as `raven.example.synology.me`; null until set. */
  hostname: nullable(isPublicHostname),
  /** The port the router forwards from the internet; null until set. */
  publicPort: nullable(isPort),
  /** The port on the NAS the router forwards to, the reverse proxy's; null when it is the public port. */
  privatePort: nullable(isPort),
  /** The home network's upload, in megabits a second; null when not known. */
  uploadMbps: nullable(isUploadMbps),
  /** The size a transcode for a viewer away from home is held to. */
  remoteLimit: isRemoteLimit,
})

export type RemoteAccessSettings = Infer<typeof isRemoteAccessSettings>

export const DEFAULT_REMOTE_ACCESS_SETTINGS: RemoteAccessSettings = {
  isEnabled: false,
  hostname: null,
  publicPort: null,
  privatePort: null,
  uploadMbps: null,
  remoteLimit: REMOTE_LIMITS.original,
}

/** A change sends any of the fields; each given must be a value the setting takes. */
export const isRemoteAccessChange = exactPartial(isRemoteAccessSettings.shape)

export type RemoteAccessChange = Infer<typeof isRemoteAccessChange>

/** What the reachability check found, or why it could not look. */
export const REMOTE_ACCESS_STATES = {
  disabled: 'disabled',
  unconfigured: 'unconfigured',
  unchecked: 'unchecked',
  reachable: 'reachable',
  unreachable: 'unreachable',
} as const

/** Why raven could not be reached from outside. */
export const REACHABILITY_PROBLEMS = {
  /** The hostname does not resolve. */
  dns: 'dns',
  /** It resolves to a private, loopback or shared address, never one the internet reaches. */
  privateAddress: 'privateAddress',
  /** Nothing listens on the port, or the router refused. */
  refused: 'refused',
  /** No answer in time: no port forward, a firewall, or CGNAT. */
  timeout: 'timeout',
  /** Something answered, but its certificate is not trusted for the hostname. */
  certificate: 'certificate',
  /** Something answered on that port, but not this raven. */
  notRaven: 'notRaven',
  /** The check itself could not run. */
  checkerFailed: 'checkerFailed',
} as const

export const isReachabilityProblem = oneOf(Object.values(REACHABILITY_PROBLEMS))

export type ReachabilityProblem = Infer<typeof isReachabilityProblem>

/** What the outside check saw: the address the home network calls from, and where the hostname points. */
const SEEN_FIELDS = { publicAddress: nullable(isString), resolved: listOf(isString) }

/** What the reachability function answers the server. */
export const isReachabilityReport = union(
  object({ state: literal(REMOTE_ACCESS_STATES.reachable), ...SEEN_FIELDS }),
  object({
    state: literal(REMOTE_ACCESS_STATES.unreachable),
    problem: isReachabilityProblem,
    ...SEEN_FIELDS,
  }),
)

export type ReachabilityReport = Infer<typeof isReachabilityReport>

const CHECKED_FIELDS = { ...SEEN_FIELDS, checkedAt: isString }

/** Whether raven is reachable from outside its network, as the Admin page shows it. */
export const isRemoteAccessStatus = union(
  object({ state: literal(REMOTE_ACCESS_STATES.disabled) }),
  object({ state: literal(REMOTE_ACCESS_STATES.unconfigured) }),
  object({ state: literal(REMOTE_ACCESS_STATES.unchecked) }),
  object({
    state: literal(REMOTE_ACCESS_STATES.reachable),
    /** Whether the check's request reached raven with its own address forwarded, not the reverse proxy's. */
    isClientAddressForwarded: isBoolean,
    ...CHECKED_FIELDS,
  }),
  object({
    state: literal(REMOTE_ACCESS_STATES.unreachable),
    problem: isReachabilityProblem,
    ...CHECKED_FIELDS,
  }),
)

export type RemoteAccessStatus = Infer<typeof isRemoteAccessStatus>

/** What `GET /api/remote-access` answers the owner. */
export const isRemoteAccessState = object({
  settings: isRemoteAccessSettings,
  /** The NAS's address on the home network, from the `lan` media origin; null without one. */
  privateAddress: nullable(isString),
  /** The origin viewers away from home reach raven at; null until enabled and configured. */
  publicOrigin: nullable(isString),
  status: isRemoteAccessStatus,
})

export type RemoteAccessState = Infer<typeof isRemoteAccessState>

/** A check's nonce: 16 random bytes in base64url without padding. */
export const isEchoNonce = matching(/^[A-Za-z0-9_-]{22}$/)

/** A check's signature: the HMAC-SHA256 of its nonce, as 64 lower case hex digits. */
export const isCheckSignature = matching(/^[0-9a-f]{64}$/)

/** What raven asks the reachability function: where to look, the nonce its echo holds, and the nonce's signature. */
export const isReachabilityQuery = object({
  host: isPublicHostname,
  port: isPort,
  nonce: isEchoNonce,
  signature: isCheckSignature,
})

export type ReachabilityQuery = Infer<typeof isReachabilityQuery>

/** The query string raven sends the reachability function, without its `?`. */
export const reachabilityQueryString = ({
  host,
  port,
  nonce,
  signature,
}: ReachabilityQuery): string =>
  toQueryString({
    [REACHABILITY_PARAMS.host]: host,
    [REACHABILITY_PARAMS.port]: String(port),
    [REACHABILITY_PARAMS.nonce]: nonce,
    [REACHABILITY_PARAMS.signature]: signature,
  })

/** A port as a query writes it: plain decimal digits, never hex, an exponent or a sign. */
const PORT_DIGITS = /^\d{1,5}$/

/** The reachability query in a URL's search (with its `?` or without), or null when any part is missing or malformed. */
export const readReachabilityQuery = (search: string): ReachabilityQuery | null => {
  const params = fromQueryString(search)
  const portText = params[REACHABILITY_PARAMS.port] ?? ''
  const query = {
    host: params[REACHABILITY_PARAMS.host],
    port: PORT_DIGITS.test(portText) ? Number(portText) : Number.NaN,
    nonce: params[REACHABILITY_PARAMS.nonce],
    signature: params[REACHABILITY_PARAMS.signature],
  }
  return isReachabilityQuery(query) ? query : null
}
