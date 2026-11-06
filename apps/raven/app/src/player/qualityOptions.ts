import {
  type MediaItem,
  PLAYBACK_MODES,
  type PlaybackMode,
  STREAM_QUALITIES,
  type StreamQuality,
  formatBitrate,
  isStreamQuality,
  offeredQualities,
} from '@raven/core'

import { QUALITY_COPY } from '@/player/copy'

/** The quality picker's own choice beside the sizes: Direct play, which no size takes. */
export const QUALITY_CHOICES = { direct: 'direct' } as const

/** A choice in the quality picker: its key and how it reads. */
type QualityOption = { key: string; label: string }

type LabelledProps = { label: string; bitsPerSecond: number | null }

/** `label` with its bitrate beside it, or alone before the file is probed. */
const labelled = ({ label, bitsPerSecond }: LabelledProps): string => {
  const details = formatBitrate(bitsPerSecond)
  return details === null ? label : QUALITY_COPY.withDetails({ label, details })
}

type QualityOptionsOfProps = {
  media: MediaItem
  /** The plan's ways: sizes are offered only when it holds a transcode. */
  modes: readonly PlaybackMode[]
  /** The height the server's settings cap a transcode at. */
  maxHeight: number
}

/**
 * The quality list: Direct play first, always, the file itself at its own bitrate, which the
 * viewer may pick whatever the plan started with; then each size core's `offeredQualities` says
 * the file can be converted down to, largest first, with its bitrate. A plan with no transcode
 * (transcoding off here or on the server) offers no size.
 */
export const qualityOptionsOf = ({
  media,
  modes,
  maxHeight,
}: QualityOptionsOfProps): QualityOption[] => {
  const sizes = modes.includes(PLAYBACK_MODES.transcode)
    ? offeredQualities({ media, maxHeight })
    : []
  return [
    {
      key: QUALITY_CHOICES.direct,
      label: labelled({ label: QUALITY_COPY.direct, bitsPerSecond: media.bitrate }),
    },
    ...sizes.map((quality) => ({
      key: quality,
      label: labelled({
        label: STREAM_QUALITIES[quality].label,
        bitsPerSecond: STREAM_QUALITIES[quality].bitrate,
      }),
    })),
  ]
}

type QualityKeyOfProps = { mode: PlaybackMode | null; quality: StreamQuality | null }

/**
 * The picker's key for what plays: Direct play's while the file plays as it is, a picked size's
 * while it is converted to one, and none (the empty key, no option's) for a remux or a transcode
 * at the server's own size.
 */
export const qualityKeyOf = ({ mode, quality }: QualityKeyOfProps): string => {
  if (quality !== null) return quality
  return mode === PLAYBACK_MODES.direct ? QUALITY_CHOICES.direct : ''
}

/** The size a picked key names; null for Direct play. */
export const pickedQualityOf = (key: string): StreamQuality | null =>
  isStreamQuality(key) ? key : null
