import {
  type ApiClient,
  type MediaItem,
  type MediaTracks,
  PLAYBACK_MODES,
  type PlaybackMode,
  type StreamMode,
  type VideoRange,
  type VideoStream,
  codecLabel,
  formatBitrate,
  formatBytes,
  formatChannels,
  formatFrameRate,
  formatSampleRate,
  resolutionLabel,
  audioLabel,
} from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useId, useState } from 'react'
import { Icon } from '@/components/Icon/Icon'
import type { EngineStats } from '@/components/Player/engine'
import { stepDownNote } from '@/components/Player/playbackFacts'
import type { StepDown } from '@/components/Player/usePlaybackLadder'
import styles from '@/components/Player/PlaybackInfo.module.scss'
import { playerQueriesFor } from '@/lib/playerQueries'

/** How often the live figures are read again. */
const REFRESH_MS = 1000

/** The library file a server source plays; a local file has none. */
export type PlaybackFile = { media: MediaItem; api: ApiClient }

type Fact = { term: string; value: string | null }

const METHODS: Record<PlaybackMode, string> = {
  direct: 'Direct play',
  remux: 'Remux',
  transcode: 'Transcode',
}

const RANGES: Record<VideoRange, string> = {
  sdr: 'SDR',
  hdr10: 'HDR10',
  hlg: 'HLG',
  dolbyVision: 'Dolby Vision',
}

const dimensions = ({ width, height }: { width: number; height: number }): string =>
  `${width}×${height}`

/** "H.264 High", "AAC LC"; the profile alone when it names the codec already: "DTS-HD MA". */
const codecWithProfile = ({
  codec,
  profile,
}: {
  codec: string | null
  profile: string | null
}): string | null => {
  if (codec == null) return null
  const label = codecLabel(codec)
  if (profile == null) return label
  return profile.toLowerCase().includes(label.toLowerCase()) ? profile : `${label} ${profile}`
}

/** The probe's name for the range once it is in, the index's HDR flag until then. */
const rangeLabel = ({
  media,
  video,
}: {
  media: MediaItem
  video: VideoStream | null
}): string | null => {
  if (video) return RANGES[video.range]
  if (media.videoCodec == null) return null
  return media.hdr ? 'HDR' : 'SDR'
}

/** The file's frame and what raven calls it: "1920×800 (1080p)". */
const frameSize = (media: MediaItem): string | null => {
  const { width, height } = media
  if (width == null || height == null) return null
  return `${dimensions({ width, height })} (${resolutionLabel({ width, height }) ?? 'SD'})`
}

const viewportSize = (viewport: EngineStats['viewport']): string | null => {
  if (!viewport) return null
  const scale = Number(viewport.scale.toFixed(2))
  return scale === 1 ? dimensions(viewport) : `${dimensions(viewport)} at ${scale}×`
}

/** Reads the engine's figures now, then once a second while the panel is open. */
const useLiveStats = (read: () => EngineStats): EngineStats => {
  const [stats, setStats] = useState(read)
  const refresh = useEffectEvent(() => setStats(read()))
  useEffect(() => {
    const timer = window.setInterval(refresh, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])
  return stats
}

/** A titled group of terms and values; a fact with no value is left out. */
const Facts = ({
  title,
  facts,
  note = null,
}: {
  title: string
  facts: readonly Fact[]
  note?: string | null
}) => (
  <section className={styles.section}>
    <h3 className={styles.title}>{title}</h3>
    <dl className={styles.facts}>
      {facts.flatMap(({ term, value }) =>
        value == null
          ? []
          : [
              <div key={term} className={styles.fact}>
                <dt className={styles.term}>{term}</dt>
                <dd className={styles.value}>{value}</dd>
              </div>,
            ],
      )}
    </dl>
    {!!note && <p className={styles.note}>{note}</p>}
  </section>
)

/** What the server turns the file into, by the playback settings it streams with. */
const Conversion = ({ file: { media, api }, mode }: { file: PlaybackFile; mode: StreamMode }) => {
  const settings = useQuery(playerQueriesFor(api).playbackSettings).data?.settings ?? null
  const transcoded = settings
    ? `H.264, re-encoded up to ${settings.maxHeight === 2160 ? '4K' : `${settings.maxHeight}p`} at ${settings.quality} quality`
    : 'H.264, re-encoded'
  return (
    <Facts
      title="Conversion"
      facts={[
        {
          term: 'Video codec',
          value:
            mode === PLAYBACK_MODES.remux
              ? `${codecLabel(media.videoCodec)}, copied as it is`
              : transcoded,
        },
        // Every converted stream's audio is stereo AAC.
        { term: 'Audio codec', value: media.audioCodec == null ? null : 'AAC stereo, re-encoded' },
      ]}
    />
  )
}

/** The file on disk: the index's figures at once, the probe's detail once it is read. */
const OriginalFile = ({
  file: { media, api },
  tracks,
  audio,
}: {
  file: PlaybackFile
  tracks: MediaTracks | null
  audio: number | null
}) => {
  const streams = useQuery(playerQueriesFor(api).streams(media.id))
  const video = streams.data?.video ?? null
  const sound = streams.data?.audio.find((stream) => stream.index === audio) ?? null
  const track = tracks?.audio.find((candidate) => candidate.index === audio) ?? null
  const note = streams.isPending
    ? "Reading the file's streams"
    : streams.isError
      ? "The file's streams could not be read."
      : null
  return (
    <Facts
      title="Original file"
      note={note}
      facts={[
        { term: 'Container', value: media.container.toUpperCase() },
        { term: 'Size', value: formatBytes(media.size) },
        { term: 'Bitrate', value: formatBitrate(media.bitrate) },
        {
          term: 'Video codec',
          value: codecWithProfile({
            codec: video?.codec ?? media.videoCodec,
            profile: video?.profile ?? null,
          }),
        },
        {
          term: 'Bit depth',
          value: media.videoBitDepth == null ? null : `${media.videoBitDepth}-bit`,
        },
        { term: 'Resolution', value: frameSize(media) },
        { term: 'Frame rate', value: formatFrameRate(tracks?.frameRate ?? null) },
        { term: 'Video bitrate', value: formatBitrate(video?.bitrate ?? null) },
        { term: 'Range', value: rangeLabel({ media, video }) },
        { term: 'Audio track', value: track && audioLabel(track).name },
        {
          term: 'Audio codec',
          value: codecWithProfile({
            codec: sound?.codec ?? track?.codec ?? media.audioCodec,
            profile: sound?.profile ?? null,
          }),
        },
        {
          term: 'Channels',
          value: formatChannels(sound?.channels ?? track?.channels ?? media.audioChannels),
        },
        { term: 'Audio bitrate', value: formatBitrate(sound?.bitrate ?? null) },
        { term: 'Sample rate', value: formatSampleRate(sound?.sampleRate ?? null) },
      ]}
    />
  )
}

/**
 * The detail behind the settings menu's last line: how the video reaches
 * the browser, how the picture is doing, and what the file is. A panel
 * rather than a modal, so it can stay open over the video while it plays.
 */
export const PlaybackInfo = ({
  readStats,
  mode,
  steppedDown = null,
  file,
  tracks,
  audio,
  onClose,
}: {
  readStats: () => EngineStats
  mode: PlaybackMode
  /** Why this is a transcode, when the connection is the reason. */
  steppedDown?: StepDown | null
  file: PlaybackFile | null
  tracks: MediaTracks | null
  /** The audio track playing. */
  audio: number | null
  onClose: () => void
}) => {
  const heading = useId()
  const stats = useLiveStats(readStats)
  return (
    <div className={styles.layer}>
      <dialog open className={styles.panel} aria-labelledby={heading}>
        <header className={styles.header}>
          <h2 id={heading} className={styles.heading}>
            Playback info
          </h2>
          <button
            type="button"
            className={styles.close}
            aria-label="Close playback info"
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className={styles.sections}>
          <Facts
            title="Playback"
            note={steppedDown && stepDownNote(steppedDown)}
            facts={[
              { term: 'Player', value: stats.engine },
              { term: 'Method', value: METHODS[mode] },
              {
                term: 'Delivery',
                value:
                  mode === PLAYBACK_MODES.direct
                    ? 'The file as it is'
                    : 'Fragmented MP4 through MSE',
              },
            ]}
          />
          <Facts
            title="Video"
            facts={[
              { term: 'Player size', value: viewportSize(stats.viewport) },
              { term: 'Decoded size', value: stats.frame && dimensions(stats.frame) },
              {
                term: 'Dropped frames',
                value:
                  stats.frames &&
                  `${stats.frames.dropped.toLocaleString()} of ${stats.frames.total.toLocaleString()}`,
              },
            ]}
          />
          {file != null && mode !== PLAYBACK_MODES.direct && <Conversion file={file} mode={mode} />}
          {file != null && <OriginalFile file={file} tracks={tracks} audio={audio} />}
        </div>
      </dialog>
    </div>
  )
}
