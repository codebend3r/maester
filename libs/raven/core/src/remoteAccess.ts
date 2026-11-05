import {
  HTTPS_PORT,
  MEDIA_ORIGIN_KINDS,
  type MediaItem,
  type MediaOrigin,
  PLAYBACK_MODES,
  REMOTE_LIMITS,
  type RemoteAccessSettings,
  type RemotePlayback,
  STREAM_QUALITIES,
  type StreamQuality,
  isStreamQuality,
} from '@/contract'
import type { PlaybackPlan } from '@/playback'

const BITS_PER_MEGABIT = 1_000_000

type PublicOriginProps = Pick<RemoteAccessSettings, 'isEnabled' | 'hostname' | 'publicPort'>

/** Where viewers away from home reach raven: `https://<hostname>`, with the port unless it is 443. Null until enabled and configured. */
export const publicOriginOf = ({
  isEnabled,
  hostname,
  publicPort,
}: PublicOriginProps): string | null => {
  if (!isEnabled || hostname === null || publicPort === null) return null
  return publicPort === HTTPS_PORT ? `https://${hostname}` : `https://${hostname}:${publicPort}`
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

type AwayPlayProps = {
  /** The media origin the player plays from; null for the server's own address. */
  origin: Pick<MediaOrigin, 'kind'> | null
  /** What `GET /api/media-origins` said of remote play; null or undefined from a server that says nothing. */
  remote: RemotePlayback | null | undefined
}

/** Whether a play is away from home: from a `public` origin, or from the server's own address reached from outside. */
export const isAwayPlay = ({ origin, remote }: AwayPlayProps): boolean =>
  origin === null ? !!remote?.isOutside : origin.kind === MEDIA_ORIGIN_KINDS.public

type RemoteTranscodeProps = AwayPlayProps & { media: Pick<MediaItem, 'bitrate'> }

/**
 * The size to transcode at instead of sending the file, as Plex does for a
 * viewer away from home: the remote limit, when the play is away (a `public`
 * origin, or the server's own address reached from outside) and the file's
 * bitrate is over that limit. Null to plan as at home: on the LAN, with no
 * limit, or for a file that fits, or one whose bitrate is not known.
 */
export const remoteTranscodeFor = ({
  media,
  origin,
  remote,
}: RemoteTranscodeProps): StreamQuality | null => {
  const limit = remote?.limit ?? null
  if (limit === null || media.bitrate === null) return null
  return isAwayPlay({ origin, remote }) && media.bitrate > STREAM_QUALITIES[limit].bitrate
    ? limit
    : null
}

type PlanForNetworkProps = RemoteTranscodeProps & { plan: PlaybackPlan }

/** A plan with the remote limit applied, and the size its transcode is asked at; null for the server's own. */
export type NetworkPlan = { plan: PlaybackPlan; quality: StreamQuality | null }

/**
 * Every client's plan away from home: when `remoteTranscodeFor` holds the
 * file to a size and the plan can transcode, the transcode goes first, at
 * that size, and the other ways stay behind it to step down to. A plan
 * with no transcode, or a play at home, is as it was.
 */
export const planForNetwork = ({ plan, ...props }: PlanForNetworkProps): NetworkPlan => {
  const quality = remoteTranscodeFor(props)
  if (quality === null || !plan.modes.includes(PLAYBACK_MODES.transcode)) {
    return { plan, quality: null }
  }
  return {
    plan: {
      ...plan,
      modes: [
        PLAYBACK_MODES.transcode,
        ...plan.modes.filter((mode) => mode !== PLAYBACK_MODES.transcode),
      ],
    },
    quality,
  }
}
