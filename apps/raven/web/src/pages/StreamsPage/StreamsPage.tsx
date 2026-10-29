import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type AudioTrack,
  type LiveDownload,
  type LiveStream,
  PLAYBACK_MODES,
  type PlaybackMode,
  STREAM_PURPOSES,
  STREAM_QUALITIES,
  type StreamQuality,
  VIDEO_RANGE_LABELS,
  audioLabel,
  codecLabel,
  codecWithProfile,
  formatBitrate,
  formatByteRate,
  formatBytes,
  formatChannels,
  formatDuration,
  mediaLabel,
  plural,
  resolutionLabel,
} from '@raven/core'
import { Button } from '@raven/ui'
import { type ReactNode, useId, useState } from 'react'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { ManagersOnly } from '@/components/ManagersOnly/ManagersOnly'
import {
  PictureChip,
  PictureFact,
  ResolutionChip,
} from '@/components/ResolutionChip/ResolutionChip'
import { ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { useManagement } from '@/lib/management'
import { api } from '@/lib/api'
import { liveStreamsQuery, mediaStreamsQuery, tracksQuery } from '@/lib/queries'
import { queryKeys } from '@raven/ui/headless'
import styles from '@/pages/StreamsPage/StreamsPage.module.scss'
import { PageTitle } from '@/components/PageTitle/PageTitle'

const MODE_LABELS = {
  [PLAYBACK_MODES.direct]: 'Direct play',
  [PLAYBACK_MODES.remux]: 'Remuxing',
  [PLAYBACK_MODES.transcode]: 'Transcoding',
} as const satisfies Record<PlaybackMode, string>

/** Every converted stream's audio, whatever the track was. */
const CONVERTED_AUDIO = 'AAC stereo'

type Fact = { term: string; value: ReactNode }

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
    <h4 className={styles.panelTitle}>{title}</h4>
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
  const resolution = resolutionLabel(media)
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
            value:
              resolution == null && range == null ? null : (
                <PictureFact resolution={resolution} rest={range} />
              ),
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

type UseStopProps = { stream: LiveStream }

/** Stop cuts the connections; the client is free to ask again, and the list shows it if it does. */
const useStop = ({ stream }: UseStopProps) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.stopStream(stream.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.liveStreams }),
  })
}

type CardTopProps = { stream: LiveStream; title: string }

/** A card's picture, its name and who is asking for it, from where. */
const CardTop = ({ stream, title }: CardTopProps) => {
  const thumbnail = api.thumbnailUrl(stream.media)
  return (
    <>
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
        <h3 className={styles.title}>{title}</h3>
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
    </>
  )
}

type StopErrorProps = { error: Error | null }

const StopError = ({ error }: StopErrorProps) =>
  error != null && (
    <p className={styles.error} role="alert">
      Could not stop it: {error.message}
    </p>
  )

type StreamRowProps = { stream: LiveStream }

/**
 * One stream as a card, closed to start with: its picture, name and who
 * is watching, a line of tags for the picture, the sound, the rate and the
 * mode, and how far along it is, with Stop and the way to open it at the
 * right. Stop cuts the connections; the player is free to ask again, and
 * the list shows it if it does.
 */
const StreamRow = ({ stream }: StreamRowProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const detailsId = useId()
  const tracks = useQuery(tracksQuery(stream.media.id))
  const stop = useStop({ stream })
  const title = mediaLabel(stream.media)
  const track = tracks.data?.audio.find(({ index }) => index === stream.audio) ?? null
  const rate = formatBitrate(stream.sendRate)

  return (
    <li className={styles.row}>
      <div className={styles.overview}>
        <CardTop stream={stream} title={title} />
        <ul className={styles.tags} aria-label="How it plays">
          <li className={styles.chip}>
            <ResolutionChip resolution={resolutionLabel(stream.media)} />
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
      <StopError error={stop.error} />
    </li>
  )
}

type DownloadRowProps = { stream: LiveDownload }

/**
 * One download as a card: its picture, name and who is fetching it, the
 * picture's tags and the file's size, how much of the file has been sent
 * and how fast it is coming, in megabytes a second, and Stop. A stopped
 * download is the client's to resume, and the list shows it if it does.
 */
const DownloadRow = ({ stream }: DownloadRowProps) => {
  const stop = useStop({ stream })
  const amountId = useId()
  const title = mediaLabel(stream.media)
  const { size } = stream.media
  const { received } = stream

  return (
    <li className={styles.row}>
      <div className={styles.overview}>
        <CardTop stream={stream} title={title} />
        <ul className={styles.tags} aria-label="What it downloads">
          <li className={styles.chip}>
            <ResolutionChip resolution={resolutionLabel(stream.media)} />
          </li>
          {stream.media.hdr && (
            <li className={styles.chip}>
              <PictureChip>HDR</PictureChip>
            </li>
          )}
          <li className={styles.tag}>{formatBytes(size)}</li>
        </ul>
        <div className={styles.download}>
          <progress
            className={styles.gauge}
            max={size}
            value={received}
            aria-labelledby={amountId}
          />
          <p id={amountId} className={styles.time}>
            {`${formatBytes(received)} of ${formatBytes(size)}`}
          </p>
          <p className={styles.rate}>
            <span className="visually-hidden">Download rate </span>
            {formatByteRate(stream.sendRate) ?? 'Measuring'}
          </p>
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
              Stop downloading {title} to {stream.device}
            </span>
          </Button>
        </div>
      </div>
      <StopError error={stop.error} />
    </li>
  )
}

type SectionProps = {
  heading: string
  /** How many there are, or the line for none. */
  summary: string
  children: ReactNode
}

/** One kind of stream under its heading and count, its cards below when it has any. */
const Section = ({ heading, summary, children }: SectionProps) => {
  const headingId = useId()
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <hgroup className={styles.heading}>
        <h2 id={headingId} className={styles.sectionTitle}>
          {heading}
        </h2>
        <p className={styles.summary}>{summary}</p>
      </hgroup>
      {children}
    </section>
  )
}

type CountedProps = { n: number; one: string; many: string; none: string }

const counted = ({ n, one, many, none }: CountedProps): string =>
  n === 0 ? none : plural({ n, one, many })

const isDownload = (stream: LiveStream): stream is LiveDownload =>
  stream.purpose === STREAM_PURPOSES.download

type SectionsProps = { streams: readonly LiveStream[] }

/** The streams being watched over the downloads, each kind in a section of its own. */
const Sections = ({ streams }: SectionsProps) => {
  const downloads = streams.filter(isDownload)
  const plays = streams.filter((stream) => !isDownload(stream))
  return (
    <>
      <Section
        heading="Streaming"
        summary={counted({
          n: plays.length,
          one: 'stream',
          many: 'streams',
          none: 'Nobody is streaming right now',
        })}
      >
        {plays.length > 0 && (
          <ul className={styles.list}>
            {plays.map((stream) => (
              <StreamRow key={stream.id} stream={stream} />
            ))}
          </ul>
        )}
      </Section>
      <Section
        heading="Downloading"
        summary={counted({
          n: downloads.length,
          one: 'download',
          many: 'downloads',
          none: 'Nothing is downloading right now',
        })}
      >
        {downloads.length > 0 && (
          <ul className={styles.list}>
            {downloads.map((stream) => (
              <DownloadRow key={stream.id} stream={stream} />
            ))}
          </ul>
        )}
      </Section>
    </>
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
 * `/streams`: what the server is sending right now, in two sections: the
 * streams being watched, one card per viewer and video, newest last, with
 * who is watching, on what, how it plays and how far along it is, and the
 * downloads Raven is fetching, with how much has come and how fast. Each
 * card has Stop. It is for the admin, or the owner once
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
        <PageTitle icon="playback">Streams</PageTitle>
      </header>
      {streams.isError && <p role="alert">The server did not answer: {streams.error.message}</p>}
      {streams.isPending && <RowsSkeleton />}
      {streams.data && <Sections streams={streams.data} />}
    </section>
  )
}
