import { artistNames } from '@raven/core'
import { AUDIO_STATES, playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { useRouter, useSegments } from 'expo-router'
import { useEffect } from 'react'

import { NowPlayingStrip } from '@/layouts'
import { trackCoverOf } from '@/music/musicCards'
import type { AppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { APP_ROUTES, APP_SCREENS } from '@/routes'
import { useMusicStarts } from '@/stores/musicStarts'

/** The screens the bar stays off: the film player, and Now Playing, which is the bar opened up. */
const BARLESS_SCREENS: ReadonlySet<string> = new Set([APP_SCREENS.play, APP_SCREENS.nowPlaying])

/** Whether the bar shows: while a track is queued, off the screens above. */
export const useIsBarShown = (): boolean => {
  const screen = useSegments().join('/')
  const hasTrack = useAudioQueue((store) => playingTrackOf(store) !== null)
  return hasTrack && !BARLESS_SCREENS.has(screen)
}

type NowPlayingBarProps = { session: Pick<AppQueries, 'server' | 'api'> }

/**
 * Counts each queue that starts playing in `useMusicStarts`, whose count the TV's strip answers
 * by taking the remote: a new queue (`playTracks`) hands the store a fresh set of tracks and
 * starts loading, which neither moving along the queue nor adding to it does.
 */
const useCountMusicStarts = (): void => {
  const start = useMusicStarts((starts) => starts.start)
  useEffect(
    () =>
      useAudioQueue.subscribe((now, was) => {
        if (now.tracks !== was.tracks && now.state === AUDIO_STATES.loading && now.shouldPlay) {
          start()
        }
      }),
    [start],
  )
}

/**
 * The strip under the screens while a track plays, each platform's own: its cover, title and
 * artists, play or pause and next; pressed, it opens Now Playing.
 */
export const NowPlayingBar = ({ session: { server, api } }: NowPlayingBarProps) => {
  const router = useRouter()
  const pictures = usePictures({ server, api })
  const track = useAudioQueue(playingTrackOf)
  const state = useAudioQueue((store) => store.state)
  const toggle = useAudioQueue((store) => store.toggle)
  const next = useAudioQueue((store) => store.next)
  const isShown = useIsBarShown()
  useCountMusicStarts()
  return (
    track !== null &&
    isShown && (
      <NowPlayingStrip
        artists={artistNames(track)}
        cover={
          pictures === null ? null : trackCoverOf({ api, headersFor: pictures.headersFor, track })
        }
        isPlaying={state === AUDIO_STATES.playing || state === AUDIO_STATES.loading}
        onNext={next}
        onOpen={() => router.push(APP_ROUTES.nowPlaying)}
        onToggle={toggle}
        title={track.title}
      />
    )
  )
}
