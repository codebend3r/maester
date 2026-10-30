import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import Video, { type VideoMetadata } from 'react-native-video'

import { PlayerNotice } from '@/layouts/PlayerNotice.focus'
import { type PlayerChromeKit, type PlayerChromeProps } from '@/layouts/playerKit'
import { pictureStyles } from '@/theme/useTheme'

type InfoOfProps = Pick<PlayerChromeProps, 'title' | 'summary' | 'artwork'>

/** What the system's info panel shows: the title, the synopsis and the poster, where known. */
const infoOf = ({ title, summary, artwork }: InfoOfProps): VideoMetadata => ({
  title,
  ...(summary === null ? {} : { description: summary }),
  ...(artwork === null ? {} : { imageUri: artwork }),
})

/**
 * The video under Apple TV's own transport (AVPlayerViewController): the remote's swipe scrubs,
 * a press plays and pauses, the info panel shows the title, synopsis and poster, and the audio
 * and subtitle panel lists the stream's renditions. raven draws nothing over it, so the
 * transport owns the remote's focus, and Menu leaves the player. While there is nothing to play
 * it is the TV's notice with Back.
 */
const PlayerChrome = ({
  title,
  heading,
  summary,
  artwork,
  surface,
  notice,
  isOpening,
  onBack,
}: PlayerChromeProps) => {
  const source = surface?.source ?? null
  const styles = useStyles()
  // The source is the video: a new object of the same values must not reload it.
  const withInfo = useMemo(
    () =>
      source === null ? undefined : { ...source, metadata: infoOf({ title, summary, artwork }) },
    [source, title, summary, artwork],
  )
  if (surface === null) {
    return <PlayerNotice heading={heading} isOpening={isOpening} notice={notice} onBack={onBack} />
  }
  return (
    <View style={styles.ground}>
      <Video
        {...surface}
        controls
        resizeMode="contain"
        source={withInfo}
        style={StyleSheet.absoluteFill}
      />
    </View>
  )
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
