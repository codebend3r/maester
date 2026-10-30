import { artistNames } from '@raven/core'
import { AUDIO_STATES, playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { useRouter, useSegments } from 'expo-router'

import { NowPlayingStrip } from '@/layouts'
import { trackCoverOf } from '@/music/musicCards'
import type { AppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { APP_ROUTES, APP_SCREENS } from '@/routes'

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
  if (track === null || !isShown) return null
  return (
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
}
