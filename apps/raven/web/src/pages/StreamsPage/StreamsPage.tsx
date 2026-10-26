import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type AudioTrack,
  type LiveStream,
  PLAYBACK_MODES,
  type PlaybackMode,
  STREAM_QUALITIES,
  type StreamQuality,
  VIDEO_RANGE_LABELS,
  audioLabel,
  codecLabel,
  codecWithProfile,
  formatBitrate,
  formatChannels,
  formatDuration,
  mediaLabel,
  plural,
  resolutionLabel,
} from '@raven/core'
import { Button } from '@raven/ui'
import { useId, useState } from 'react'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { ManagersOnly } from '@/components/ManagersOnly/ManagersOnly'
import { PictureChip, ResolutionChip } from '@/components/ResolutionChip/ResolutionChip'
import { ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { useManagement } from '@/lib/management'
import { api } from '@/lib/api'
import { liveStreamsQuery, mediaStreamsQuery, tracksQuery } from '@/lib/queries'
import { queryKeys } from '@raven/ui/headless'
import styles from '@/pages/StreamsPage/StreamsPage.module.scss'

const MODE_LABELS = {
  [PLAYBACK_MODES.direct]: 'Direct play',
  [PLAYBACK_MODES.remux]: 'Remuxing',
  [PLAYBACK_MODES.transcode]: 'Transcoding',
} as const satisfies Record<PlaybackMode, string>

/** Every converted stream's audio, whatever the track was. */
const CONVERTED_AUDIO = 'AAC stereo'

type Fact = { term: string; value: string | null }

const joined = (parts: ReadonlyArray<string | null>): string =>
  parts.filter((part): part is string => !!part).join(' · ')

type ProgressWordsProps = { stream: LiveStream }

/** Where playback is, as "12:04 of 45:30"; "Starting" until the player first reports. */
const progressWords = ({ stream }: ProgressWordsProps): string => {
  if (stream.position == null) return 'Starting'
  if (stream.media.duration == null) return formatDuration(stream.position)
  return `${formatDuration(stream.position)} of ${formatDuration(stream.media.duration)}`
}

type WatcherWordsProps = { stream: LiveStream }

/** Who is watching on what: "sam@example.com on iPhone", or the client alone on a server without accounts. */
const watcherWords = ({ stream }: WatcherWordsProps): string =>
  stream.viewer == null
    ? `${stream.device}, ${stream.browser}`
    : `${stream.viewer} on ${stream.device}`

type SentVideoProps = {
  mode: PlaybackMode
  quality: StreamQuality | null
}

/** The picture the player gets: the file's own, or what a conversion makes of it. */
const sentVideo = ({ mode, quality }: SentVideoProps): string => {
  switch (mode) {
    case PLAYBACK_MODES.direct:
      return 'The original file'
    case PLAYBACK_MODES.remux:
      return 'Copied as it is'
    case PLAYBACK_MODES.transcode:
      return quality == null
        ? 'Converted to H.264'
        : `Converted to ${STREAM_QUALITIES[quality].label}`
    default: {
      const unreachable: never = mode
      throw new Error(`Unknown playback mode: ${String(unreachable)}`)
    }
  }
}

type SentAudioProps = { mode: PlaybackMode; track: AudioTrack }

/** The sound the player gets: the track as it is on direct play, stereo AAC from a conversion. */
const sentAudio = ({ mode, track }: SentAudioProps): string =>
  mode === PLAYBACK_MODES.direct
    ? joined([codecLabel(track.codec), formatChannels(track.channels)])
    : CONVERTED_AUDIO

type FactsProps = { title: string; facts: readonly Fact[] }

/** A titled group of terms and values; a fact with no value is left out. */
const Facts = ({ title, facts }: FactsProps) => (
  <section className={styles.panel}>
    <h3 className={styles.panelTitle}>{title}</h3>
    <dl className={styles.facts}>
      {facts.flatMap(({ term, value }) =>
        value == null
          ? []
          : [
              <div key={term} className={styles.fact}>
                <dt className={styles.factName}>{term}</dt>
                <dd className={styles.factValue}>{value}</dd>
              </div>,
            ],
      )}
    </dl>
  </section>
)

type StreamDetailsProps = {
  id: string
  stream: LiveStream
  track: AudioTrack | null
}

/**
 * An open card's four panels: who is watching, and the picture, the sound
 * and the bandwidth, each as the file has it and as the player gets it. The
 * file's streams are probed on the server, so they are asked for only once
 * a card opens.
 */
const StreamDetails = ({ id, stream, track }: StreamDetailsProps) => {
  const { media, mode } = stream
  const probe = useQuery(mediaStreamsQuery(media.id))
  const video = probe.data?.video ?? null
  const sound = probe.data?.audio.find(({ index }) => index === stream.audio) ?? null
  const range = video == null ? (media.hdr ? 'HDR' : null) : VIDEO_RANGE_LABELS[video.range]
  return (
    <div id={id} className={styles.details}>
      <Facts
        title="Viewer"
        facts={[
          { term: 'Account', value: stream.viewer },
          { term: 'Device', value: `${stream.device} · ${stream.browser}` },
          { term: 'Address', value: stream.address },
        ]}
      />
      <Facts
        title="Video"
        facts={[
          {
            term: 'Picture',
            value: joined([resolutionLabel(media), range]),
          },
          {
            term: 'Codec',
            value: codecWithProfile({
              codec: video?.codec ?? media.videoCodec,
              profile: video?.profile ?? null,
            }),
          },
          { term: 'Sent as', value: sentVideo({ mode, quality: stream.quality }) },
        ]}
      />
      <Facts
        title="Audio"
        facts={[
          { term: 'Track', value: track == null ? null : audioLabel(track).name },
          {
            term: 'Format',
            value:
              track == null
                ? null
                : joined([
                    codecWithProfile({ codec: track.codec, profile: sound?.profile ?? null }),
                    formatChannels(track.channels),
                  ]),
          },
          { term: 'Sent as', value: track == null ? null : sentAudio({ mode, track }) },
        ]}
      />
      <Facts
        title="Bandwidth"
        facts={[
          { term: 'Sending now', value: formatBitrate(stream.sendRate) ?? 'Measuring' },
          { term: 'File average', value: formatBitrate(media.bitrate) },
          { term: 'Mode', value: MODE_LABELS[mode] },
        ]}
      />
    </div>
  )
}

type StreamRowProps = { stream: LiveStream }

/**
 * One stream as a card, closed to start with: its picture, name and who
 * is watching, a line of tags for the picture, the sound, the rate and the
 * mode, and how far along it is, with Stop and the way to open it at the
 * right. Stop cuts the connections; the player is free to ask again, and
 * the list shows it if it does.
 */
const StreamRow = ({ stream }: StreamRowProps) => {
  const queryClient = useQueryClient()
  const [isOpen, setIsOpen] = useState(false)
  const detailsId = useId()
  const tracks = useQuery(tracksQuery(stream.media.id))
  const stop = useMutation({
    mutationFn: () => api.stopStream(stream.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.liveStreams }),
  })
  const title = mediaLabel(stream.media)
  const thumbnail = api.thumbnailUrl(stream.media)
  const track = tracks.data?.audio.find(({ index }) => index === stream.audio) ?? null
  const rate = formatBitrate(stream.sendRate)

  return (
    <li className={styles.row}>
      <div className={styles.overview}>
        <span className={styles.frame}>
          {thumbnail && (
            <img
              className={styles.thumbnail}
              src={thumbnail}
              alt=""
              loading="lazy"
              decoding="async"
            />
          )}
        </span>
        <hgroup className={styles.naming}>
          <h2 className={styles.title}>{title}</h2>
          <p className={styles.byline}>
            {stream.viewer != null && (
              <>
                <span className={styles.avatar} aria-hidden="true">
                  {stream.viewer.charAt(0).toUpperCase()}
                </span>{' '}
              </>
            )}
            <span>{watcherWords({ stream })}</span>
            <span aria-hidden="true"> · </span>
            <span>{stream.libraryName}</span>
          </p>
        </hgroup>
        <ul className={styles.tags} aria-label="How it plays">
          <li className={styles.chip}>
            <ResolutionChip media={stream.media} />
          </li>
          {stream.media.hdr && (
            <li className={styles.chip}>
              <PictureChip>HDR</PictureChip>
            </li>
          )}
          {track != null && (
            <li className={styles.tag}>
              {joined([audioLabel(track).name, sentAudio({ mode: stream.mode, track })])}
            </li>
          )}
          {rate != null && <li className={styles.tag}>{rate}</li>}
          <li className={styles.tag}>{MODE_LABELS[stream.mode]}</li>
        </ul>
        <div className={styles.progress}>
          <ResumeBar
            media={{ ...stream.media, position: stream.position ?? 0 }}
            tone="inline"
            className={styles.bar}
          />
          <p className={styles.time}>{progressWords({ stream })}</p>
        </div>
        <div className={styles.actions}>
          <Button
            tone="danger"
            icon="close"
            disabled={stop.isPending}
            onClick={() => stop.mutate()}
          >
            <span aria-hidden="true">Stop</span>
            <span className="visually-hidden">
              Stop {title} on {stream.device}, {stream.browser}
            </span>
          </Button>
          <Button
            icon="expand"
            className={styles.toggle}
            aria-expanded={isOpen}
            aria-controls={detailsId}
            aria-label={`${isOpen ? 'Hide' : 'Show'} the details of ${title}`}
            onClick={() => setIsOpen((was) => !was)}
          />
        </div>
      </div>
      {isOpen && <StreamDetails id={detailsId} stream={stream} track={track} />}
      {stop.isError && (
        <p className={styles.error} role="alert">
          Could not stop it: {stop.error.message}
        </p>
      )}
    </li>
  )
}

/** Two cards on their way, each a line for its name over one for its facts. */
const RowsSkeleton = () => (
  <Loading label="Looking for streams">
    <ul className={styles.list}>
      {['first', 'second'].map((row) => (
        <li key={row} className={styles.rowSkeleton}>
          <Bone shape="heading" width="half" />
          <Bone shape="small" width="short" />
        </li>
      ))}
    </ul>
  </Loading>
)

/**
 * `/streams`: what the server is sending right now, one card per viewer and
 * video, newest last, with who is watching, on what, how it plays and how
 * far along it is, and Stop on each. It is for the admin, or the owner once
 * accounts are on, so it asks only while the viewer may manage, and says so
 * otherwise. The list is read every couple of seconds.
 */
export const StreamsPage = () => {
  const { mode, canManage } = useManagement()
  const streams = useQuery({ ...liveStreamsQuery, enabled: canManage })

  if (!canManage) {
    return (
      <ManagersOnly
        mode={mode}
        name="Streams"
        forAdmin="see who is streaming and to stop a stream"
        forOwner="see who is streaming and stop a stream"
      />
    )
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <BackButton fallback={HOME} className={styles.back} />
        <hgroup className={styles.heading}>
          <h1>Streams</h1>
          {streams.data && (
            <p className={styles.summary}>
              {streams.data.length === 0
                ? 'Nobody is streaming right now'
                : plural({ n: streams.data.length, one: 'stream', many: 'streams' })}
            </p>
          )}
        </hgroup>
      </header>
      {streams.isError && <p role="alert">The server did not answer: {streams.error.message}</p>}
      {streams.isPending && <RowsSkeleton />}
      {streams.data && streams.data.length > 0 && (
        <ul className={styles.list}>
          {streams.data.map((stream) => (
            <StreamRow key={stream.id} stream={stream} />
          ))}
        </ul>
      )}
    </section>
  )
}
