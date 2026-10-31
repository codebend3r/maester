import {
  type MixDetails,
  type MixKind,
  QUEUE_SOURCE_KINDS,
  RADIO_SEED_KINDS,
  ROUTE_STATES,
  type RouteQuery,
  isMixKind,
  routeState,
} from '@raven/core'
import { Button } from '@raven/ui'
import { KeyedView, type ViewOf, type ViewsOf, useAudioQueue } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { useParams } from 'react-router-dom'
import { BackButton } from '@/components/BackButton/BackButton'
import { MixCovers } from '@/components/MixGrid/MixGrid'
import { RouteState } from '@/components/RouteState/RouteState'
import { Bone } from '@/components/Skeleton/Skeleton'
import { START_RADIO_LOOKS, StartRadio } from '@/components/StartRadio/StartRadio'
import { TrackList, type TrailProps } from '@/components/TrackList/TrackList'
import { COMMON_COPY, MUSIC_COPY } from '@/lib/copy'
import { mixFacts } from '@/lib/music'
import { mixQuery } from '@/lib/queries'
import { useMusicLinks } from '@/lib/useMusicLinks'
import { MIX_PAGE_COPY } from '@/pages/MixPage/copy'
import styles from '@/pages/MixPage/MixPage.module.scss'

type MixTrackControlsProps = TrailProps

/** A mix's row: Start radio from its track. */
const MixTrackControls = ({ track }: MixTrackControlsProps) => (
  <StartRadio
    seed={{ kind: RADIO_SEED_KINDS.track, id: track.id }}
    title={track.title}
    look={START_RADIO_LOOKS.icon}
  />
)

type MixViewProps = { details: MixDetails }

/** The page once its mix is known: its covers, name and length, Play and Shuffle, then its tracks. */
const MixView = ({ details }: MixViewProps) => {
  const titleId = useId()
  const links = useMusicLinks()
  const playTracks = useAudioQueue((store) => store.playTracks)
  const { mix, tracks } = details
  const source = { kind: QUEUE_SOURCE_KINDS.mix, id: mix.id }
  return (
    <article className={styles.page} aria-labelledby={titleId}>
      <BackButton fallback={links.home} className={styles.back} />
      <header className={styles.header}>
        <div className={styles.cover}>
          <MixCovers mix={mix} />
        </div>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>{MIX_PAGE_COPY.eyebrow}</p>
          <h1 id={titleId} className={styles.title}>
            {MUSIC_COPY.mixNames[mix.id]}
          </h1>
          <p className={styles.facts}>{mixFacts({ mix }).join(COMMON_COPY.separator)}</p>
          <p className={styles.facts}>{MIX_PAGE_COPY.note}</p>
          <div className={styles.actions}>
            <Button
              tone="primary"
              icon="play"
              disabled={tracks.length === 0}
              onClick={() => playTracks({ tracks, source })}
            >
              {COMMON_COPY.play}
            </Button>
            <Button
              icon="shuffle"
              disabled={tracks.length === 0}
              onClick={() => playTracks({ tracks, source, isShuffled: true })}
            >
              {COMMON_COPY.shuffle}
            </Button>
          </div>
        </div>
      </header>
      <div className={styles.tracks}>
        <TrackList
          tracks={tracks}
          onPlay={(startAt) => playTracks({ tracks, startAt, source })}
          numberOf={({ index }) => index + 1}
          Trail={MixTrackControls}
          label={MIX_PAGE_COPY.tracks}
        />
      </div>
    </article>
  )
}

const MixSkeleton = () => (
  <>
    <Bone shape="button" />
    <Bone shape="hero" width="half" />
    <Bone shape="text" width="short" />
    <Bone shape="text" width="most" />
  </>
)

const MIX_VIEW_KEYS = { pending: 'pending', ready: 'ready' } as const

type MixPageViewProps = {
  [MIX_VIEW_KEYS.pending]: Parameters<typeof RouteState>[0]
  [MIX_VIEW_KEYS.ready]: MixViewProps
}

const MIX_VIEWS = {
  [MIX_VIEW_KEYS.pending]: RouteState,
  [MIX_VIEW_KEYS.ready]: MixView,
} as const satisfies ViewsOf<MixPageViewProps>

type MixPageViewOfProps = { page: RouteQuery<MixDetails> }

const mixPageViewOf = ({ page }: MixPageViewOfProps): ViewOf<MixPageViewProps> => {
  if (page.state !== ROUTE_STATES.ready)
    return {
      key: MIX_VIEW_KEYS.pending,
      props: { state: page, noun: MIX_PAGE_COPY.noun, shape: <MixSkeleton /> },
    }
  return { key: MIX_VIEW_KEYS.ready, props: { details: page.data } }
}

/** The mix kind the address names, or null for anything else: the address is the viewer's to type. */
const useRouteMix = (): MixKind | null => {
  const id = useParams().id
  return isMixKind(id) ? id : null
}

/** `/music/mixes/:id`: one of today's mixes, played as a queue whose source is the mix. */
export const MixPage = () => {
  const kind = useRouteMix()
  const mix = useQuery(mixQuery(kind))
  const page = routeState({ id: kind, query: mix })
  return <KeyedView<MixPageViewProps> views={MIX_VIEWS} view={mixPageViewOf({ page })} />
}
