import {
  type ApiClient,
  type MediaItem,
  type MediaTracks,
  PLAYBACK_MODES,
  type PlaybackMode,
  type StreamMode,
  VIDEO_RANGE_LABELS,
  type VideoStream,
  audioLabel,
  codecLabel,
  codecWithProfile,
  formatBitrate,
  formatBytes,
  formatChannels,
  formatFrameRate,
  formatSampleRate,
  resolutionLabel,
} from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useId, useState } from 'react'
import { Icon } from '@/components/Icon/Icon'
import { PLAYBACK_INFO_COPY } from '@/components/Player/copy'
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

const METHODS = {
  direct: PLAYBACK_INFO_COPY.directPlay,
  remux: PLAYBACK_INFO_COPY.remux,
  transcode: PLAYBACK_INFO_COPY.transcode,
} as const satisfies Record<PlaybackMode, string>

type DimensionsProps = { width: number; height: number }

const dimensions = ({ width, height }: DimensionsProps): string => `${width}×${height}`

type RangeLabelProps = {
  media: MediaItem
  video: VideoStream | null
}

/** The probe's name for the range once it is in, the index's HDR flag until then. */
const rangeLabel = ({ media, video }: RangeLabelProps): string | null => {
  if (video) return VIDEO_RANGE_LABELS[video.range]
  if (media.videoCodec == null) return null
  return media.hdr ? PLAYBACK_INFO_COPY.hdr : PLAYBACK_INFO_COPY.sdr
}

/** The file's frame and what raven calls it: "1920×800 (1080p)". */
const frameSize = (media: MediaItem): string | null => {
  const { width, height } = media
  if (width == null || height == null) return null
  return PLAYBACK_INFO_COPY.frameSize({
    size: dimensions({ width, height }),
    name: resolutionLabel({ width, height }) ?? PLAYBACK_INFO_COPY.standardDefinition,
  })
}

const viewportSize = (viewport: EngineStats['viewport']): string | null => {
  if (!viewport) return null
  const scale = Number(viewport.scale.toFixed(2))
  return scale === 1
    ? dimensions(viewport)
    : PLAYBACK_INFO_COPY.scaledSize({ size: dimensions(viewport), scale })
}

/** A conversion's height as the settings name it: "4K", or "720p". */
const heightName = (height: number): string =>
  height === 2160 ? PLAYBACK_INFO_COPY.fourK : PLAYBACK_INFO_COPY.height(height)

type StreamsNoteOfProps = { isPending: boolean; isError: boolean }

/** What the original file's section says while its streams are read, or once they could not be. */
const streamsNoteOf = ({ isPending, isError }: StreamsNoteOfProps): string | null => {
  if (isPending) return PLAYBACK_INFO_COPY.readingStreams
  return isError ? PLAYBACK_INFO_COPY.streamsFailed : null
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

type FactsProps = {
  title: string
  facts: readonly Fact[]
  note?: string | null
}

/** A titled group of terms and values; a fact with no value is left out. */
const Facts = ({ title, facts, note = null }: FactsProps) => (
  <section className={styles.section}>
    <h3 className={styles.title}>{title}</h3>
    <dl className={styles.facts}>
      {facts
        .filter(({ value }) => value != null)
        .map(({ term, value }) => (
          <div key={term} className={styles.fact}>
            <dt className={styles.term}>{term}</dt>
            <dd className={styles.value}>{value}</dd>
          </div>
        ))}
    </dl>
    {!!note && <p className={styles.note}>{note}</p>}
  </section>
)

type ConversionProps = { file: PlaybackFile; mode: StreamMode }

/** What the server turns the file into, by the playback settings it streams with. */
const Conversion = ({ file: { media, api }, mode }: ConversionProps) => {
  const settings = useQuery(playerQueriesFor(api).playbackSettings).data?.settings ?? null
  const transcoded = settings
    ? PLAYBACK_INFO_COPY.transcoded({
        size: heightName(settings.maxHeight),
        quality: settings.quality,
      })
    : PLAYBACK_INFO_COPY.reencoded
  return (
    <Facts
      title={PLAYBACK_INFO_COPY.conversion}
      facts={[
        {
          term: PLAYBACK_INFO_COPY.videoCodec,
          value:
            mode === PLAYBACK_MODES.remux
              ? PLAYBACK_INFO_COPY.copied(codecLabel(media.videoCodec))
              : transcoded,
        },
        // Every converted stream's audio is stereo AAC.
        {
          term: PLAYBACK_INFO_COPY.audioCodec,
          value: media.audioCodec == null ? null : PLAYBACK_INFO_COPY.stereoAac,
        },
      ]}
    />
  )
}

type OriginalFileProps = {
  file: PlaybackFile
  tracks: MediaTracks | null
  audio: number | null
}

/** The file on disk: the index's figures at once, the probe's detail once it is read. */
const OriginalFile = ({ file: { media, api }, tracks, audio }: OriginalFileProps) => {
  const streams = useQuery(playerQueriesFor(api).streams(media.id))
  const video = streams.data?.video ?? null
  const sound = streams.data?.audio.find((stream) => stream.index === audio) ?? null
  const track = tracks?.audio.find((candidate) => candidate.index === audio) ?? null
  const note = streamsNoteOf(streams)
  return (
    <Facts
      title={PLAYBACK_INFO_COPY.originalFile}
      note={note}
      facts={[
        { term: PLAYBACK_INFO_COPY.container, value: media.container.toUpperCase() },
        { term: PLAYBACK_INFO_COPY.size, value: formatBytes(media.size) },
        { term: PLAYBACK_INFO_COPY.bitrate, value: formatBitrate(media.bitrate) },
        {
          term: PLAYBACK_INFO_COPY.videoCodec,
          value: codecWithProfile({
            codec: video?.codec ?? media.videoCodec,
            profile: video?.profile ?? null,
          }),
        },
        {
          term: PLAYBACK_INFO_COPY.bitDepth,
          value: media.videoBitDepth == null ? null : PLAYBACK_INFO_COPY.bits(media.videoBitDepth),
        },
        { term: PLAYBACK_INFO_COPY.resolution, value: frameSize(media) },
        { term: PLAYBACK_INFO_COPY.frameRate, value: formatFrameRate(tracks?.frameRate ?? null) },
        { term: PLAYBACK_INFO_COPY.videoBitrate, value: formatBitrate(video?.bitrate ?? null) },
        { term: PLAYBACK_INFO_COPY.range, value: rangeLabel({ media, video }) },
        { term: PLAYBACK_INFO_COPY.audioTrack, value: track && audioLabel(track).name },
        {
          term: PLAYBACK_INFO_COPY.audioCodec,
          value: codecWithProfile({
            codec: sound?.codec ?? track?.codec ?? media.audioCodec,
            profile: sound?.profile ?? null,
          }),
        },
        {
          term: PLAYBACK_INFO_COPY.channels,
          value: formatChannels(sound?.channels ?? track?.channels ?? media.audioChannels),
        },
        { term: PLAYBACK_INFO_COPY.audioBitrate, value: formatBitrate(sound?.bitrate ?? null) },
        { term: PLAYBACK_INFO_COPY.sampleRate, value: formatSampleRate(sound?.sampleRate ?? null) },
      ]}
    />
  )
}

type PlaybackInfoProps = {
  readStats: () => EngineStats
  mode: PlaybackMode
  /** Why this is a transcode, when the connection is the reason. */
  steppedDown?: StepDown | null
  file: PlaybackFile | null
  tracks: MediaTracks | null
  /** The audio track playing. */
  audio: number | null
  onClose: () => void
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
}: PlaybackInfoProps) => {
  const heading = useId()
  const stats = useLiveStats(readStats)
  return (
    <div className={styles.layer}>
      <dialog open className={styles.panel} aria-labelledby={heading}>
        <header className={styles.header}>
          <h2 id={heading} className={styles.heading}>
            {PLAYBACK_INFO_COPY.heading}
          </h2>
          <button
            type="button"
            className={styles.close}
            aria-label={PLAYBACK_INFO_COPY.close}
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className={styles.sections}>
          <Facts
            title={PLAYBACK_INFO_COPY.playback}
            note={steppedDown && stepDownNote(steppedDown)}
            facts={[
              { term: PLAYBACK_INFO_COPY.player, value: stats.engine },
              { term: PLAYBACK_INFO_COPY.method, value: METHODS[mode] },
              {
                term: PLAYBACK_INFO_COPY.delivery,
                value:
                  mode === PLAYBACK_MODES.direct
                    ? PLAYBACK_INFO_COPY.asItIs
                    : PLAYBACK_INFO_COPY.fragmented,
              },
            ]}
          />
          <Facts
            title={PLAYBACK_INFO_COPY.video}
            facts={[
              { term: PLAYBACK_INFO_COPY.playerSize, value: viewportSize(stats.viewport) },
              {
                term: PLAYBACK_INFO_COPY.decodedSize,
                value: stats.frame && dimensions(stats.frame),
              },
              {
                term: PLAYBACK_INFO_COPY.droppedFrames,
                value:
                  stats.frames &&
                  PLAYBACK_INFO_COPY.droppedOf({
                    dropped: stats.frames.dropped.toLocaleString(),
                    total: stats.frames.total.toLocaleString(),
                  }),
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
