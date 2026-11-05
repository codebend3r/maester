import {
  HTTPS_PORT,
  MEDIA_ORIGIN_KINDS,
  type MediaItem,
  type MediaOrigin,
  PLAYBACK_MODES,
  REMOTE_ACCESS_STATES,
  REMOTE_LIMITS,
  type RemoteAccessSettings,
  type RemoteAccessStatus,
  type RemotePlayback,
  STREAM_QUALITIES,
  type StreamQuality,
  isStreamQuality,
} from '@/contract'
import type { PlaybackPlan } from '@/playback'

const BITS_PER_MEGABIT = 1_000_000

/** How far the owner's settings get raven's public origin: off, missing a hostname or a port, or set. */
export const PUBLIC_ORIGIN_STATES = {
  disabled: REMOTE_ACCESS_STATES.disabled,
  unconfigured: REMOTE_ACCESS_STATES.unconfigured,
  configured: 'configured',
} as const

/** The public origin, with the hostname and the port it is made of once configured. */
export type PublicOrigin =
  | { state: typeof PUBLIC_ORIGIN_STATES.disabled }
  | { state: typeof PUBLIC_ORIGIN_STATES.unconfigured }
  | {
      state: typeof PUBLIC_ORIGIN_STATES.configured
      /** `https://<hostname>`, with the port unless it is 443. */
      origin: string
      hostname: string
      publicPort: number
    }

type PublicOriginProps = Pick<RemoteAccessSettings, 'isEnabled' | 'hostname' | 'publicPort'>

/** Where viewers away from home reach raven, or why there is nowhere yet: off, or missing a hostname or a port. */
export const publicOriginStateOf = ({
  isEnabled,
  hostname,
  publicPort,
}: PublicOriginProps): PublicOrigin => {
  if (!isEnabled) return { state: PUBLIC_ORIGIN_STATES.disabled }
  if (hostname === null || publicPort === null) return { state: PUBLIC_ORIGIN_STATES.unconfigured }
  const origin =
    publicPort === HTTPS_PORT ? `https://${hostname}` : `https://${hostname}:${publicPort}`
  return { state: PUBLIC_ORIGIN_STATES.configured, origin, hostname, publicPort }
}

/** `publicOriginStateOf`'s origin, null until enabled and configured. */
export const publicOriginOf = (settings: PublicOriginProps): string | null => {
  const publicOrigin = publicOriginStateOf(settings)
  return publicOrigin.state === PUBLIC_ORIGIN_STATES.configured ? publicOrigin.origin : null
}

/** What a reachability check saw, and when: the home network's address, where the hostname points. */
export type CheckFacts = Pick<
  Extract<RemoteAccessStatus, { state: typeof REMOTE_ACCESS_STATES.reachable }>,
  'publicAddress' | 'resolved' | 'checkedAt'
>

/** What the last check saw, for a status that comes from one; null for a status no check made. */
export const checkFactsOf = (status: RemoteAccessStatus): CheckFacts | null => {
  switch (status.state) {
    case REMOTE_ACCESS_STATES.disabled:
    case REMOTE_ACCESS_STATES.unconfigured:
    case REMOTE_ACCESS_STATES.unchecked:
      return null
    case REMOTE_ACCESS_STATES.reachable:
    case REMOTE_ACCESS_STATES.unreachable:
      return {
        publicAddress: status.publicAddress,
        resolved: status.resolved,
        checkedAt: status.checkedAt,
      }
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

type RemoteCeilingProps = Pick<RemoteAccessSettings, 'remoteLimit' | 'uploadMbps'>

/** The bits a second one remote stream may take: under the limit and the upload; Infinity for none. */
const remoteCeilingOf = ({ remoteLimit, uploadMbps }: RemoteCeilingProps): number => {
  const limit =
    remoteLimit === REMOTE_LIMITS.original ? Infinity : STREAM_QUALITIES[remoteLimit].bitrate
  const upload = uploadMbps === null ? Infinity : uploadMbps * BITS_PER_MEGABIT
  return Math.min(limit, upload)
}

const BY_BITRATE = isStreamQuality.values.toSorted(
  (a, b) => STREAM_QUALITIES[b].bitrate - STREAM_QUALITIES[a].bitrate,
)

/**
 * The size a transcode for a viewer away from home is held to: the largest of
 * `STREAM_QUALITIES` under both the limit and the upload speed, the
 * smallest when even that is over. Null when neither holds anything back.
 */
export const remoteQualityFor = (settings: RemoteCeilingProps): StreamQuality | null => {
  const ceiling = remoteCeilingOf(settings)
  if (ceiling === Infinity) return null
  return (
    BY_BITRATE.find((quality) => STREAM_QUALITIES[quality].bitrate <= ceiling) ??
    BY_BITRATE.at(-1) ??
    null
  )
}

type RemoteStreamsProps = { quality: StreamQuality; uploadMbps: number }

/** How many remote streams at `quality` the upload carries at once. */
export const remoteStreamsAt = ({ quality, uploadMbps }: RemoteStreamsProps): number =>
  Math.floor((uploadMbps * BITS_PER_MEGABIT) / STREAM_QUALITIES[quality].bitrate)

/** Where a video plays from, as the remote limit reads it. */
export type PlayNetwork = {
  /** The media origin the player plays from; null for the server's own address. */
  origin: Pick<MediaOrigin, 'kind'> | null
  /** What `GET /api/media-origins` said of remote play; null from a server that says nothing. */
  remote: RemotePlayback | null
}

/** The play nothing could be read for: the server's own address, held to nothing. */
export const AT_HOME: PlayNetwork = { origin: null, remote: null }

/** Whether a play is away from home: from a `public` origin, or from the server's own address reached from outside. */
export const isAwayPlay = ({ origin, remote }: PlayNetwork): boolean =>
  origin === null ? !!remote?.isOutside : origin.kind === MEDIA_ORIGIN_KINDS.public

/**
 * Whether the server's remote limit can hold back a play from `network`: it
 * is away from home and the server names a limit. A client that must ask a
 * file's bitrate before it plays asks only then.
 */
export const remoteLimitApplies = (network: PlayNetwork): boolean =>
  (network.remote?.limit ?? null) !== null && isAwayPlay(network)

type RemoteTranscodeProps = PlayNetwork & { media: Pick<MediaItem, 'bitrate'> }

/**
 * The size the server holds a transcode of this file to, as Plex does for a
 * viewer away from home: the remote limit, when it applies
 * (`remoteLimitApplies`) and the file's bitrate is over it. Null to play as
 * at home: on the LAN, with no limit, or for a file that fits, or one whose
 * bitrate is not known. The server applies the limit itself to every
 * transcode away from home; a client reads this only to decide the mode, or
 * to name the size in a URL that must carry one.
 */
export const remoteTranscodeFor = ({
  media,
  ...network
}: RemoteTranscodeProps): StreamQuality | null => {
  const limit = network.remote?.limit ?? null
  if (!remoteLimitApplies(network) || limit === null || media.bitrate === null) return null
  return media.bitrate > STREAM_QUALITIES[limit].bitrate ? limit : null
}

type PlanForNetworkProps = RemoteTranscodeProps & { plan: PlaybackPlan }

/**
 * Every client's plan away from home: when `remoteTranscodeFor` holds the
 * file to a size and the plan can transcode, the transcode goes first and
 * the other ways stay behind it to step down to. The size is the server's to
 * apply. A plan with no transcode, or a play at home, is as it was.
 */
export const planForNetwork = ({ plan, ...props }: PlanForNetworkProps): PlaybackPlan => {
  if (remoteTranscodeFor(props) === null || !plan.modes.includes(PLAYBACK_MODES.transcode)) {
    return plan
  }
  return {
    ...plan,
    modes: [
      PLAYBACK_MODES.transcode,
      ...plan.modes.filter((mode) => mode !== PLAYBACK_MODES.transcode),
    ],
  }
}
