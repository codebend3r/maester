import { AUDIO_CODECS, CONTAINERS } from '@/playback'

/** The players a phone's music can come out of: AVPlayer, ExoPlayer, and the browser's own. */
export const AUDIO_PLATFORMS = { apple: 'apple', android: 'android', browser: 'browser' } as const

export type AudioPlatform = (typeof AUDIO_PLATFORMS)[keyof typeof AUDIO_PLATFORMS]

/** A codec a player refuses, in the listed containers or, with `null`, in any. */
type AudioRefusal = { codec: string; containers: readonly string[] | null }

/**
 * What each native player will not decode, from the spec's codec table:
 * AVPlayer refuses Opus in WebM, and ExoPlayer loads ALAC silent. The
 * browser's answer comes from the element itself, so it has no table here.
 */
const AUDIO_REFUSALS = {
  [AUDIO_PLATFORMS.apple]: [{ codec: AUDIO_CODECS.opus, containers: [CONTAINERS.webm] }],
  [AUDIO_PLATFORMS.android]: [{ codec: AUDIO_CODECS.alac, containers: null }],
  [AUDIO_PLATFORMS.browser]: [],
} as const satisfies Record<AudioPlatform, readonly AudioRefusal[]>

type CanPlayAudioProps = {
  platform: AudioPlatform
  /** ffprobe's codec name for the track. */
  codec: string
  /** The container, as `containerOf` names it. */
  container: string
}

export const canPlayAudio = ({ platform, codec, container }: CanPlayAudioProps): boolean => {
  const refusals: readonly AudioRefusal[] = AUDIO_REFUSALS[platform]
  return !refusals.some(
    (refusal) => refusal.codec === codec && (refusal.containers?.includes(container) ?? true),
  )
}
