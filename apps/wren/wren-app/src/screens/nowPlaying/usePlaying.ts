import type { Track } from '@raven/core'
import { NOW_PLAYING_COPY } from '@raven/wren'
import { type PlayingSong, type WrenSession, usePlayingSong } from '@raven/wren-native'
import { WREN_PAGES, pageHref } from '@raven/wren-native/headless'
import { useRouter } from 'expo-router'
import { Platform } from 'react-native'

import { deviceOf } from '@/screens/nowPlaying/device'
import { useFormFactor } from '@/theme/wrenTheme'

/** Everything both layouts draw the playing song from. */
export type Playing = Omit<PlayingSong, 'firstArtist'> & {
  /** "raven · This iPhone". */
  output: string
  /** "Playing on this iPad". */
  playingOn: string
  close: () => void
  /** Opens the song's first artist's page, or nothing when it credits none. */
  openArtist: (() => void) | null
}

type UsePlayingProps = { session: WrenSession; track: Track }

/** The playing song, its cover, artists and length, its lyrics, where it plays from and on, and the ways out of the sheet. */
export const usePlaying = ({ session, track }: UsePlayingProps): Playing => {
  const { firstArtist, ...song } = usePlayingSong({ session, track })
  const router = useRouter()
  const formFactor = useFormFactor()
  const device = deviceOf({ os: Platform.OS, formFactor })
  const close = () => router.back()
  return {
    ...song,
    output: NOW_PLAYING_COPY.output({ server: session.server.name, device }),
    playingOn: NOW_PLAYING_COPY.playingOn(device),
    close,
    openArtist:
      firstArtist === null
        ? null
        : () => {
            close()
            router.push(pageHref({ page: WREN_PAGES.artist, id: firstArtist.id }))
          },
  }
}
