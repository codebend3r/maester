import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type LiveStream,
  PLAYBACK_MODES,
  type PlaybackMode,
  formatDuration,
  mediaLabel,
} from '@raven/core'
import { Button } from '@raven/ui'
import { Link } from 'react-router-dom'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { ResumeBar } from '@/components/ResumeBar/ResumeBar'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { useCanManage } from '@/lib/adminLock'
import { api } from '@/lib/api'
import { plural } from '@/lib/plural'
import { liveStreamsQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/queryClient'
import styles from '@/pages/StreamsPage/StreamsPage.module.scss'

const MODE_LABELS = {
  [PLAYBACK_MODES.direct]: 'Direct play',
  [PLAYBACK_MODES.remux]: 'Remuxing',
  [PLAYBACK_MODES.transcode]: 'Transcoding',
} as const satisfies Record<PlaybackMode, string>

/** Where playback is, as "12:04 of 45:30"; "Starting" until the player first reports. */
const progressWords = ({ stream }: { stream: LiveStream }): string => {
  if (stream.position == null) return 'Starting'
  if (stream.media.duration == null) return formatDuration(stream.position)
  return `${formatDuration(stream.position)} of ${formatDuration(stream.media.duration)}`
}

/**
 * One stream as a card: its picture and name, who is watching and on what,
 * how far they are, and Stop at the right. Stop cuts the connections; the
 * player is free to ask again, and the list shows it if it does.
 */
const StreamRow = ({ stream }: { stream: LiveStream }) => {
  const queryClient = useQueryClient()
  const stop = useMutation({
    mutationFn: () => api.stopStream(stream.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.liveStreams }),
  })
  const title = mediaLabel(stream.media)
  const thumbnail = api.thumbnailUrl(stream.media)
  const facts = [
    { name: 'Device', value: stream.device },
    { name: 'Browser', value: stream.browser },
    { name: 'Address', value: stream.address },
    { name: 'Sent as', value: MODE_LABELS[stream.mode] },
  ]

  return (
    <li className={styles.row}>
      <div className={styles.details}>
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
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.library}>{stream.libraryName}</p>
        <dl className={styles.facts}>
          {facts.map(({ name, value }) => (
            <div key={name} className={styles.fact}>
              <dt className={styles.factName}>{name}</dt>
              <dd className={styles.factValue}>{value}</dd>
            </div>
          ))}
        </dl>
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
        </div>
        {stop.isError && (
          <p className={styles.error} role="alert">
            Could not stop it: {stop.error.message}
          </p>
        )}
      </div>
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
 * video, newest last, with the device and browser it is going to and how
 * far along it is, and Stop on each. It is for the admin, so it asks only
 * while the admin lock is off, and says so while it is on. The list is read
 * every couple of seconds.
 */
export const StreamsPage = () => {
  const canManage = useCanManage()
  const streams = useQuery({ ...liveStreamsQuery, enabled: canManage })

  if (!canManage) {
    return (
      <section className={styles.empty}>
        <BackButton fallback={HOME} className={styles.back} />
        <div className={styles.emptyBody}>
          <h1 className={styles.emptyTitle}>Streams are for the admin</h1>
          <p>
            Turn the admin lock off in <Link to="/settings">Settings</Link> to see who is streaming
            and to stop a stream.
          </p>
        </div>
      </section>
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
