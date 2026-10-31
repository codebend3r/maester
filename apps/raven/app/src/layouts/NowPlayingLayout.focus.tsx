import type { ComponentType } from 'react'
import { StyleSheet, View } from 'react-native'
import type { QueueRow } from '@raven/ui/headless'

import { FocusBand } from '@/layouts/FocusBand'
import { useScreenFocusScope } from '@/layouts/focus'
import { BUTTON_TONES } from '@/layouts/formKit'
import { MUSIC_COPY } from '@/layouts/copy'
import {
  type NowPlayingLayoutProps,
  PLAYING_STATES,
  type PlayingState,
  playingStateOf,
  shuffleLabelOf,
  toggleLabelOf,
} from '@/layouts/musicKit'
import { NowPlayingAside } from '@/layouts/NowPlayingAside.focus'
import { ActionPlate, Cover, FocusPage, FocusRow, useMusicStyles } from '@/layouts/MusicParts.focus'
import { Text } from '@/layouts/Text'
import { TV_SIZES, tvSize } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

/** The cover on Now Playing, the page's picture. */
const PLAYING_COVER = tvSize(560)

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    error: { color: colours.error, fontSize: TV_SIZES.text },
    time: { color: colours.muted, fontSize: TV_SIZES.text, fontVariant: ['tabular-nums'] },
    queueHead: { flexDirection: 'row', alignItems: 'center', gap: TV_SIZES.space4 },
    entryWords: { flex: 1, gap: TV_SIZES.space0 },
  }),
)

type QueueEntryProps = { row: QueueRow; onJump: (place: number) => void }

/** A track in the queue, pressed to play from it. */
const QueueEntry = ({ row, onJump }: QueueEntryProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  return (
    <FocusRow isSelected={row.isCurrent} label={row.title} onPress={() => onJump(row.place)}>
      <View style={own.entryWords}>
        <Text numberOfLines={1} style={[styles.rowTitle, row.isCurrent && styles.on]}>
          {row.title}
        </Text>
        <Text numberOfLines={1} style={styles.muted}>
          {row.line}
        </Text>
      </View>
    </FocusRow>
  )
}

type PlayingHeroProps = NowPlayingLayoutProps & { isOpening: boolean }

/** What plays: the cover large beside its words and the controls, Play or Pause first. */
const PlayingHero = ({
  track,
  error,
  time,
  isPlaying,
  isShuffled,
  repeat,
  onToggle,
  onPrevious,
  onNext,
  onShuffle,
  onRepeat,
  isOpening,
}: PlayingHeroProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  return (
    track !== null && (
      <FocusBand>
        <View style={styles.hero}>
          <Cover cover={track.cover} size={PLAYING_COVER} title={track.title} />
          <View style={styles.words}>
            <Text numberOfLines={2} style={styles.title}>
              {track.title}
            </Text>
            <Text numberOfLines={1} style={styles.line}>
              {track.artists}
            </Text>
            <Text numberOfLines={1} style={styles.muted}>
              {track.album}
            </Text>
            {error !== null && <Text style={own.error}>{error}</Text>}
            <Text style={own.time}>{time}</Text>
            <View style={styles.actions}>
              <ActionPlate
                icon="skipPrevious"
                isPreferred={false}
                label={MUSIC_COPY.previous}
                onPress={onPrevious}
                text={null}
                tone={BUTTON_TONES.quiet}
              />
              <ActionPlate
                icon={isPlaying ? 'pause' : 'play'}
                isPreferred={isOpening}
                label={toggleLabelOf(isPlaying)}
                onPress={onToggle}
                text={null}
                tone={BUTTON_TONES.primary}
              />
              <ActionPlate
                icon="skipNext"
                isPreferred={false}
                label={MUSIC_COPY.next}
                onPress={onNext}
                text={null}
                tone={BUTTON_TONES.quiet}
              />
            </View>
            <View style={styles.actions}>
              <ActionPlate
                icon="shuffle"
                isPreferred={false}
                label={shuffleLabelOf(isShuffled)}
                onPress={onShuffle}
                text={shuffleLabelOf(isShuffled)}
                tone={isShuffled ? BUTTON_TONES.primary : BUTTON_TONES.quiet}
              />
              <ActionPlate
                icon={null}
                isPreferred={false}
                label={MUSIC_COPY.repeat[repeat]}
                onPress={onRepeat}
                text={MUSIC_COPY.repeat[repeat]}
                tone={BUTTON_TONES.quiet}
              />
            </View>
          </View>
        </View>
      </FocusBand>
    )
  )
}

const NothingPlaying = () => {
  const styles = useMusicStyles()
  return <Text style={styles.line}>{MUSIC_COPY.nothingPlaying}</Text>
}

/** What stands under the heading: what plays, or a word that nothing does. */
const PLAYING_VIEWS = {
  [PLAYING_STATES.idle]: NothingPlaying,
  [PLAYING_STATES.playing]: PlayingHero,
} as const satisfies Record<PlayingState, ComponentType<PlayingHeroProps>>

/**
 * Now Playing on a TV: the cover large beside what plays and the controls the remote opens on,
 * Play or Pause first, then a book's controls or the lyrics, and the queue below them to move
 * down through and play from. Menu goes back.
 */
export const NowPlayingLayout = (props: NowPlayingLayoutProps) => {
  const { track, queue, onClear, onJump, aside } = props
  const { isOpening } = useScreenFocusScope()
  const styles = useMusicStyles()
  const own = useStyles()
  const Playing = PLAYING_VIEWS[playingStateOf(track)]
  return (
    <FocusPage>
      <Text accessibilityRole="header" style={styles.eyebrow}>
        {MUSIC_COPY.nowPlaying}
      </Text>
      <Playing {...props} isOpening={isOpening} />
      <NowPlayingAside aside={aside} />
      {queue.length > 0 && (
        <FocusBand>
          <View style={styles.section}>
            <View style={own.queueHead}>
              <Text accessibilityRole="header" style={styles.heading}>
                {MUSIC_COPY.upNext}
              </Text>
              <ActionPlate
                icon={null}
                isPreferred={false}
                label={MUSIC_COPY.clear}
                onPress={onClear}
                text={MUSIC_COPY.clear}
                tone={BUTTON_TONES.ghost}
              />
            </View>
            {queue.map((row) => (
              <QueueEntry key={row.key} onJump={onJump} row={row} />
            ))}
          </View>
        </FocusBand>
      )}
    </FocusPage>
  )
}
