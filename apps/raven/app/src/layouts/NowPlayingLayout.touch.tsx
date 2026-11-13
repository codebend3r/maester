import { REPEAT_MODES } from '@raven/core'
import type { ComponentType } from 'react'
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Chip } from '@/layouts/Chip.touch'
import { MUSIC_COPY } from '@/layouts/copy'
import {
  type NowPlayingAside as Aside,
  type NowPlayingLayoutProps,
  PLAYING_STATES,
  type PlayingState,
  isCentredFor,
  playingStateOf,
  repeatIconOf,
  shuffleLabelOf,
  toggleLabelOf,
} from '@/layouts/musicKit'
import { NowPlayingAside } from '@/layouts/NowPlayingAside.touch'
import {
  IconPlate,
  ListEntry,
  SeekBar,
  TouchPage,
  useMusicStyles,
} from '@/layouts/MusicParts.touch'
import { PlayingCover } from '@/layouts/PlayingCover.touch'
import { openAddToPlaylistSheet } from '@/layouts/playlistSheets'
import { isTablet } from '@/layouts/screenSizes'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { TouchNav } from '@/layouts/TouchNav'
import { SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

/**
 * How much of the screen the cover takes in each layout, as the TV sizes it: beside the lyrics,
 * large and centred for a track with no lyrics, and across a phone.
 */
const COVER_SHARES = { columns: 0.36, centred: 0.5 } as const

/** The most a cover stands, so it never crowds the controls under it. */
const COVER_MOST = { columns: 420, centred: 560, stacked: 360 } as const

/** Which of the three layouts Now Playing takes. */
const PLAYING_LAYOUTS = { columns: 'columns', centred: 'centred', stacked: 'stacked' } as const

type PlayingLayout = (typeof PLAYING_LAYOUTS)[keyof typeof PLAYING_LAYOUTS]

type LayoutOfProps = { aside: Aside; isWide: boolean }

/**
 * As the TV lays it out: on a wide screen the lyrics or a book's controls stand beside the
 * player, and a track with no lyrics puts the player dead centre; a phone stacks it all.
 */
const layoutOf = ({ aside, isWide }: LayoutOfProps): PlayingLayout => {
  if (!isWide) return PLAYING_LAYOUTS.stacked
  return isCentredFor(aside) ? PLAYING_LAYOUTS.centred : PLAYING_LAYOUTS.columns
}

type CoverSizeOfProps = { layout: PlayingLayout; width: number; height: number }

const coverSizeOf = ({ layout, width, height }: CoverSizeOfProps): number => {
  const sizes = {
    [PLAYING_LAYOUTS.columns]: Math.min(width * COVER_SHARES.columns, COVER_MOST.columns),
    [PLAYING_LAYOUTS.centred]: Math.min(
      width * COVER_SHARES.centred,
      height * COVER_SHARES.centred,
      COVER_MOST.centred,
    ),
    [PLAYING_LAYOUTS.stacked]: Math.min(width - SIZES.space4 * 2, COVER_MOST.stacked),
  } as const satisfies Record<PlayingLayout, number>
  return Math.round(sizes[layout])
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    trackTitle: { color: colours.text, fontSize: SIZES.textLg, fontWeight: '600' },
    queueHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    // What plays on the left, the lyrics or a book's controls taking the rest of the width.
    columns: { flex: 1, flexDirection: 'row', gap: SIZES.space8, paddingHorizontal: SIZES.space6 },
    left: { flexGrow: 0 },
    leftPage: { gap: SIZES.space5, paddingBottom: SIZES.space8 },
    right: { flex: 1, paddingBottom: SIZES.space4 },
    player: { gap: SIZES.space3 },
    words: { gap: SIZES.space1 },
    controls: { flexDirection: 'row', flexWrap: 'wrap', gap: SIZES.space2 },
    centred: { alignItems: 'center' },
    centredText: { textAlign: 'center' },
    centredControls: { justifyContent: 'center' },
  }),
)

type PlayerProps = NowPlayingLayoutProps & { size: number; isCentred: boolean }

/**
 * What plays, as on the TV: the cover with the equalizer over it, its words under it, the seek
 * bar, always, then the controls as icons only: Previous, Play or Pause and Next, then Shuffle,
 * Repeat and Add to playlist.
 */
const Player = ({
  track,
  error,
  position,
  duration,
  onSeek,
  isPlaying,
  isShuffled,
  repeat,
  onToggle,
  onPrevious,
  onNext,
  onShuffle,
  onRepeat,
  playlists,
  onAddToPlaylist,
  note,
  size,
  isCentred,
}: PlayerProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  return (
    track !== null && (
      <View style={[own.player, { width: size }, isCentred && own.centred]}>
        <PlayingCover cover={track.cover} size={size} title={track.title} />
        <View style={[own.words, isCentred && own.centred]}>
          <Text
            variant={TEXT_VARIANTS.display}
            numberOfLines={2}
            style={[own.trackTitle, isCentred && own.centredText]}
          >
            {track.title}
          </Text>
          <Text numberOfLines={1} style={[styles.muted, isCentred && own.centredText]}>
            {track.artists}
          </Text>
          <Text numberOfLines={1} style={[styles.muted, isCentred && own.centredText]}>
            {track.album}
          </Text>
          {error !== null && <Text style={styles.error}>{error}</Text>}
        </View>
        <SeekBar duration={duration} onSeek={onSeek} position={position} />
        <View style={[own.controls, isCentred && own.centredControls]}>
          <IconPlate
            icon={APP_ICONS.skipPrevious}
            isOn={false}
            label={MUSIC_COPY.previous}
            onPress={onPrevious}
          />
          <IconPlate
            icon={isPlaying ? APP_ICONS.pause : APP_ICONS.play}
            isOn
            label={toggleLabelOf(isPlaying)}
            onPress={onToggle}
          />
          <IconPlate
            icon={APP_ICONS.skipNext}
            isOn={false}
            label={MUSIC_COPY.next}
            onPress={onNext}
          />
          <IconPlate
            icon={APP_ICONS.shuffle}
            isOn={isShuffled}
            label={shuffleLabelOf(isShuffled)}
            onPress={onShuffle}
          />
          <IconPlate
            icon={repeatIconOf(repeat)}
            isOn={repeat !== REPEAT_MODES.off}
            label={MUSIC_COPY.repeat[repeat]}
            onPress={onRepeat}
          />
          <IconPlate
            icon={APP_ICONS.list}
            isOn={false}
            label={MUSIC_COPY.addToPlaylist}
            onPress={() =>
              openAddToPlaylistSheet({
                title: MUSIC_COPY.addTrackToPlaylist(track.title),
                playlists,
                onPick: onAddToPlaylist,
              })
            }
          />
        </View>
        {note !== null && <Text style={styles.muted}>{note}</Text>}
      </View>
    )
  )
}

const NothingPlaying = () => {
  const styles = useMusicStyles()
  return <Text style={styles.muted}>{MUSIC_COPY.nothingPlaying}</Text>
}

/** What stands under the heading: what plays, or a word that nothing does. */
const PLAYING_VIEWS = {
  [PLAYING_STATES.idle]: NothingPlaying,
  [PLAYING_STATES.playing]: Player,
} as const satisfies Record<PlayingState, ComponentType<PlayerProps>>

type QueueProps = Pick<NowPlayingLayoutProps, 'queue' | 'onClear' | 'onJump' | 'onRemove'>

/** Up next, to play from or take tracks out of, with Clear beside its heading. */
const Queue = ({ queue, onClear, onJump, onRemove }: QueueProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  return (
    queue.length > 0 && (
      <View style={styles.section}>
        <View style={own.queueHead}>
          <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.heading}>
            {MUSIC_COPY.upNext}
          </Text>
          <Chip
            icon={APP_ICONS.close}
            label={MUSIC_COPY.clear}
            onPress={onClear}
            text={MUSIC_COPY.clear}
          />
        </View>
        {queue.map((row) => (
          <ListEntry
            key={row.key}
            isSelected={row.isCurrent}
            label={row.title}
            line={row.line}
            onPress={() => onJump(row.place)}
            title={row.title}
          >
            <Chip
              icon={APP_ICONS.close}
              label={MUSIC_COPY.removeTrack(row.title)}
              onPress={() => onRemove(row.place)}
              text={MUSIC_COPY.remove}
            />
          </ListEntry>
        ))}
      </View>
    )
  )
}

type LayoutViewProps = NowPlayingLayoutProps & { size: number }

/**
 * Beside the lyrics, on a wide screen: on the left, the player and the queue, the one column
 * that scrolls, as wide as the cover; on the right, fixed, the lyrics with room to read them,
 * or a book's controls.
 */
const Columns = (props: LayoutViewProps) => {
  const { aside, size, onBack } = props
  const insets = useSafeAreaInsets()
  const styles = useMusicStyles()
  const own = useStyles()
  const Playing = PLAYING_VIEWS[playingStateOf(props.track)]
  const edges = { paddingTop: insets.top + SIZES.space3, paddingBottom: insets.bottom }
  return (
    <View style={[styles.ground, own.columns, edges]}>
      <ScrollView contentContainerStyle={own.leftPage} style={[own.left, { width: size }]}>
        <TouchNav onBack={onBack} />
        <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.heading}>
          {MUSIC_COPY.nowPlaying}
        </Text>
        <Playing {...props} isCentred={false} />
        <Queue {...props} />
      </ScrollView>
      <View style={own.right}>
        <NowPlayingAside aside={aside} isWide />
      </View>
    </View>
  )
}

/** A track with no lyrics on a wide screen: the player large, dead centre, the queue under it. */
const Centred = (props: LayoutViewProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  const Playing = PLAYING_VIEWS[playingStateOf(props.track)]
  return (
    <TouchPage onBack={props.onBack}>
      <Text
        variant={TEXT_VARIANTS.display}
        accessibilityRole="header"
        style={[styles.heading, own.centredText]}
      >
        {MUSIC_COPY.nowPlaying}
      </Text>
      <View style={own.centred}>
        <Playing {...props} isCentred />
      </View>
      <Queue {...props} />
    </TouchPage>
  )
}

/** A phone: the player across the screen, then the lyrics or a book's controls, then the queue. */
const Stacked = (props: LayoutViewProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  const Playing = PLAYING_VIEWS[playingStateOf(props.track)]
  return (
    <TouchPage onBack={props.onBack}>
      <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.heading}>
        {MUSIC_COPY.nowPlaying}
      </Text>
      <View style={own.centred}>
        <Playing {...props} isCentred />
      </View>
      <NowPlayingAside aside={props.aside} isWide={false} />
      <Queue {...props} />
    </TouchPage>
  )
}

const LAYOUT_VIEWS = {
  [PLAYING_LAYOUTS.columns]: Columns,
  [PLAYING_LAYOUTS.centred]: Centred,
  [PLAYING_LAYOUTS.stacked]: Stacked,
} as const satisfies Record<PlayingLayout, ComponentType<LayoutViewProps>>

/**
 * Now Playing under the thumb, laid out as the TV's: on an iPad, the cover with the equalizer
 * over it and the icon controls on the left and the lyrics on the right; for a track with no
 * lyrics, the player large and centred; on a phone, one column to scroll.
 */
export const NowPlayingLayout = (props: NowPlayingLayoutProps) => {
  const { width, height } = useWindowDimensions()
  const layout = layoutOf({ aside: props.aside, isWide: isTablet({ width, height }) })
  const Layout = LAYOUT_VIEWS[layout]
  return <Layout {...props} size={coverSizeOf({ layout, width, height })} />
}
