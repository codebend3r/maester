import { type ComponentType, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import Video, { type VideoMetadata } from 'react-native-video'

import { PlayerNotice } from '@/layouts/PlayerNotice.focus'
import {
  SURFACE_STATES,
  type PlayerChromeKit,
  type PlayerChromeProps,
  type SurfaceState,
  surfaceStateOf,
} from '@/layouts/playerKit'
import { pictureStyles } from '@/theme/useTheme'

type InfoOfProps = Pick<PlayerChromeProps, 'title' | 'summary' | 'artwork'>

/** What the system's info panel shows: the title, the synopsis and the poster, where known. */
const infoOf = ({ title, summary, artwork }: InfoOfProps): VideoMetadata => ({
  title,
  ...(summary === null ? {} : { description: summary }),
  ...(artwork === null ? {} : { imageUri: artwork }),
})

type FocusVideoProps = PlayerChromeProps

/** The video under Apple TV's own transport, with the info panel's metadata on its source. */
const FocusVideo = ({ title, summary, artwork, surface }: FocusVideoProps) => {
  const source = surface?.source ?? null
  const styles = useStyles()
  // The source is the video: a new object of the same values must not reload it.
  const withInfo = useMemo(
    () =>
      source === null ? undefined : { ...source, metadata: infoOf({ title, summary, artwork }) },
    [source, title, summary, artwork],
  )
  return (
    <View style={styles.ground}>
      {surface !== null && (
        <Video
          {...surface}
          controls
          resizeMode="contain"
          source={withInfo}
          style={StyleSheet.absoluteFill}
        />
      )}
    </View>
  )
}

const PLAYER_VIEWS = {
  [SURFACE_STATES.waiting]: PlayerNotice,
  [SURFACE_STATES.ready]: FocusVideo,
} as const satisfies Record<SurfaceState, ComponentType<PlayerChromeProps>>

/**
 * The video under Apple TV's own transport (AVPlayerViewController): the remote's swipe scrubs,
 * a press plays and pauses, the info panel shows the title, synopsis and poster, and the audio
 * and subtitle panel lists the stream's renditions. raven draws nothing over it, so the
 * transport owns the remote's focus, and Menu leaves the player. While there is nothing to play
 * it is the TV's notice with Back.
 */
const PlayerChrome = (props: PlayerChromeProps) => {
  const PlayerView = PLAYER_VIEWS[surfaceStateOf(props.surface)]
  return <PlayerView {...props} />
}

/** The player on Apple TV: the system's transport, which the remote drives and draws over. */
export const focusPlayerChrome: PlayerChromeKit = {
  PlayerChrome,
  shouldDrawCaptions: false,
  canDrawPictureSubtitles: false,
}

const useStyles = pictureStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
  }),
)
