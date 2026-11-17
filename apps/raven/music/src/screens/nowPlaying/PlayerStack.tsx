import { AUDIOBOOK_SPEEDS, usePlayerPrefs } from '@raven/ui/headless'
import { View } from 'react-native'

import { Adjuster } from '@/player/Adjuster'
import { SCRUBBERS, Scrubber } from '@/player/Scrubber'
import { TRANSPORTS, Transport } from '@/player/Transport'
import { NOW_PLAYING_COPY } from '@/screens/copy'
import { SongTitle } from '@/screens/nowPlaying/SongTitle'
import type { Playing } from '@/screens/nowPlaying/usePlaying'
import { themedStyles } from '@/theme/wrenTheme'
import { RADIUS, SPACE } from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { PLAYER_COPY } from '@/ui/copy'

// How far a screen reader's swipe moves the volume.
const VOLUME_STEP = 0.1

/** The speeds a book plays at, each keyed by its number: "1.25×". */
const SPEED_CHOICES = AUDIOBOOK_SPEEDS.map((speed) => ({
  key: speed,
  label: NOW_PLAYING_COPY.speedOf(speed),
}))

const useStyles = themedStyles(() => ({
  extras: { gap: SPACE.s3 },
  art: { alignSelf: 'center' },
}))

/** The book's speed, which only an audiobook offers. */
function SpeedControl() {
  const speed = usePlayerPrefs((prefs) => prefs.audiobookSpeed)
  const setSpeed = usePlayerPrefs((prefs) => prefs.setAudiobookSpeed)
  return (
    <SegmentedControl
      choices={SPEED_CHOICES}
      label={PLAYER_COPY.speed}
      onSelect={setSpeed}
      selected={speed}
    />
  )
}

type PlayerExtrasProps = { isAudiobook: boolean }

/**
 * Under the transport: Wren's own volume, a thin line beside the device's buttons, and an
 * audiobook's speed.
 */
function PlayerExtras({ isAudiobook }: PlayerExtrasProps) {
  const styles = useStyles()
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const setVolume = usePlayerPrefs((prefs) => prefs.setVolume)
  return (
    <View style={styles.extras}>
      <Adjuster
        label={PLAYER_COPY.volume}
        max={1}
        onChange={(level) => setVolume({ volume: level, muted: false })}
        step={VOLUME_STEP}
        value={volume}
        valueText={NOW_PLAYING_COPY.percent}
      />
      {isAudiobook && <SpeedControl />}
    </View>
  )
}

type PlayerStackProps = {
  playing: Playing
  /** The cover's side, which the layout fits to its column. */
  artSize: number
}

/**
 * The player, as the phone's player pane and the tablet's left column both draw it: the cover
 * large, the song, the scrubber, the transport, the volume and a book's speed.
 */
export function PlayerStack({ playing, artSize }: PlayerStackProps) {
  const styles = useStyles()
  return (
    <>
      <View style={styles.art}>
        <AlbumArt cover={playing.cover} isRaised radius={RADIUS.art} size={artSize} />
      </View>
      <SongTitle playing={playing} />
      <Scrubber kind={SCRUBBERS.player} length={playing.length} />
      <Transport kind={TRANSPORTS.player} />
      <PlayerExtras isAudiobook={playing.isAudiobook} />
    </>
  )
}
