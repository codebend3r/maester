import type { IconName } from '@raven/ui/iconDrawings'
import { type ComponentType, useState } from 'react'
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Chip } from '@/layouts/Chip.touch'
import { MUSIC_COPY } from '@/layouts/copy'
import {
  type NowPlayingLayoutProps,
  PLAYING_PANES,
  PLAYING_STATES,
  type PlayingPane,
  type PlayingState,
  paneTabsOf,
  playingStateOf,
  toggleLabelOf,
} from '@/layouts/musicKit'
import { playModesOf, queueLineOf } from '@/layouts/musicRows'
import { BookSkips, NowPlayingAside } from '@/layouts/NowPlayingAside.touch'
import {
  IconPlate,
  ListEntry,
  SeekBar,
  TouchPage,
  useMusicStyles,
} from '@/layouts/MusicParts.touch'
import { PlayingCover } from '@/layouts/PlayingCover.touch'
import { openAddToPlaylistSheet } from '@/layouts/playlistSheets'
import { TouchQualityLine } from '@/layouts/QualityLine'
import { isTablet } from '@/layouts/screenSizes'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { TouchNav } from '@/layouts/TouchNav'
import { SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

/** How much of a wide screen the cover takes, beside the pane. */
const COVER_SHARE = 0.36

/** The most a cover stands, so it never crowds the controls under it. */
const COVER_MOST = { columns: 420, stacked: 360 } as const

/** Which of the two layouts Now Playing takes. */
const PLAYING_LAYOUTS = { columns: 'columns', stacked: 'stacked' } as const

type PlayingLayout = (typeof PLAYING_LAYOUTS)[keyof typeof PLAYING_LAYOUTS]

/** On a wide screen the pane stands beside the player; a phone stacks it under. */
const layoutOf = (isWide: boolean): PlayingLayout =>
  isWide ? PLAYING_LAYOUTS.columns : PLAYING_LAYOUTS.stacked

type CoverSizeOfProps = { layout: PlayingLayout; width: number }

const coverSizeOf = ({ layout, width }: CoverSizeOfProps): number => {
  const sizes = {
    [PLAYING_LAYOUTS.columns]: Math.min(width * COVER_SHARE, COVER_MOST.columns),
    [PLAYING_LAYOUTS.stacked]: Math.min(width - SIZES.space4 * 2, COVER_MOST.stacked),
  } as const satisfies Record<PlayingLayout, number>
  return Math.round(sizes[layout])
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    trackTitle: { color: colours.text, fontSize: SIZES.textLg, fontWeight: '600' },
    // The track's name with its own actions beside it: the heart and Add to playlist.
    heading: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space2 },
    words: { flex: 1, gap: SIZES.space1 },
    transport: { flexDirection: 'row', justifyContent: 'center', gap: SIZES.space4 },
    tabs: { flexDirection: 'row', gap: SIZES.space2 },
    queueHead: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space2 },
    queueFacts: { flex: 1 },
    // What plays on the left, the pane taking the rest of the width.
    columns: { flex: 1, flexDirection: 'row', gap: SIZES.space8, paddingHorizontal: SIZES.space6 },
    left: { flexGrow: 0 },
    leftPage: { gap: SIZES.space5, paddingBottom: SIZES.space8 },
    right: { flex: 1, paddingBottom: SIZES.space4 },
    fill: { flex: 1 },
    player: { gap: SIZES.space3 },
    centred: { alignItems: 'center' },
  }),
)

type PlayerProps = NowPlayingLayoutProps & { size: number }

/**
 * What plays, in groups: the cover with the equalizer over it; the track's name with its heart
 * and Add to playlist beside it, and its format and quality under it; the seek bar, always;
 * then Previous, Play or Pause and Next alone in their row, and under them a book's own skips.
 */
const Player = ({
  track,
  error,
  quality,
  heart,
  position,
  duration,
  onSeek,
  isPlaying,
  onToggle,
  onPrevious,
  onNext,
  aside,
  playlists,
  onAddToPlaylist,
  note,
  size,
}: PlayerProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  return (
    track !== null && (
      <View style={[own.player, { width: size }]}>
        <PlayingCover
          cover={track.cover}
          isPlaying={isPlaying}
          onSeek={onSeek}
          position={position}
          size={size}
          title={track.title}
        />
        <View style={own.heading}>
          <View style={own.words}>
            <Text variant={TEXT_VARIANTS.display} numberOfLines={2} style={own.trackTitle}>
              {track.title}
            </Text>
            <Text numberOfLines={1} style={styles.muted}>
              {track.artists}
            </Text>
            <Text numberOfLines={1} style={styles.muted}>
              {track.album}
            </Text>
          </View>
          {heart}
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
        {quality !== null && <TouchQualityLine quality={quality} />}
        {error !== null && <Text style={styles.error}>{error}</Text>}
        {note !== null && <Text style={styles.muted}>{note}</Text>}
        <SeekBar duration={duration} onSeek={onSeek} position={position} />
        <View style={own.transport}>
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
        </View>
        <BookSkips aside={aside} />
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

type PaneViewProps = NowPlayingLayoutProps & {
  /** Whether the pane stands in its own column beside the player, scrolling by itself. */
  isWide: boolean
}

/*
 * Up next: how much is queued, with what changes the play order beside it, Shuffle and Repeat,
 * and Clear; then the queue, to play from or take tracks out of.
 */
const QueuePane = ({
  queue,
  queueFacts,
  isShuffled,
  repeat,
  onShuffle,
  onRepeat,
  onClear,
  onJump,
  onRemove,
  isWide,
}: PaneViewProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  const modes = playModesOf({ isShuffled, repeat })
  return (
    <View style={[styles.section, isWide && own.fill]}>
      <View style={own.queueHead}>
        <Text numberOfLines={1} style={[styles.muted, own.queueFacts]}>
          {queueFacts}
        </Text>
        <Chip
          icon={APP_ICONS.shuffle}
          isOn={modes.shuffle.isOn}
          label={modes.shuffle.label}
          onPress={onShuffle}
          text={null}
        />
        <Chip
          icon={modes.repeat.icon}
          isOn={modes.repeat.isOn}
          label={modes.repeat.label}
          onPress={onRepeat}
          text={null}
        />
        <Chip
          icon={APP_ICONS.close}
          label={MUSIC_COPY.clear}
          onPress={onClear}
          text={MUSIC_COPY.clear}
        />
      </View>
      <ScrollView nestedScrollEnabled scrollEnabled={isWide} style={isWide && own.fill}>
        {queue.map((row) => (
          <ListEntry
            key={row.key}
            isSelected={row.isCurrent}
            label={row.title}
            line={queueLineOf(row)}
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
      </ScrollView>
    </View>
  )
}

/** The other tab: the lyrics, or a book's chapters. */
const ExtrasPane = ({ aside, isWide }: PaneViewProps) => (
  <NowPlayingAside aside={aside} isWide={isWide} />
)

const PANE_VIEWS = {
  [PLAYING_PANES.queue]: QueuePane,
  [PLAYING_PANES.extras]: ExtrasPane,
} as const satisfies Record<PlayingPane, ComponentType<PaneViewProps>>

/** The icon each of the pane's tabs wears. */
const TAB_ICONS = {
  [PLAYING_PANES.queue]: APP_ICONS.music,
  [PLAYING_PANES.extras]: APP_ICONS.captions,
} as const satisfies Record<PlayingPane, IconName>

/*
 * The pane of two tabs, switched in place: Up next, the queue under its own controls, and the
 * lyrics or a book's chapters. Nothing while nothing plays.
 */
const Pane = (props: PaneViewProps) => {
  const [pane, setPane] = useState<PlayingPane>(PLAYING_PANES.queue)
  const styles = useMusicStyles()
  const own = useStyles()
  const PaneView = PANE_VIEWS[pane]
  return (
    props.track !== null && (
      <View style={[styles.section, props.isWide && own.fill]}>
        <View accessibilityLabel={MUSIC_COPY.panes} accessibilityRole="tablist" style={own.tabs}>
          {paneTabsOf(props.aside).map((tab) => (
            <Chip
              key={tab.pane}
              icon={TAB_ICONS[tab.pane]}
              isOn={pane === tab.pane}
              label={tab.label}
              onPress={() => setPane(tab.pane)}
              text={tab.label}
            />
          ))}
        </View>
        <PaneView {...props} />
      </View>
    )
  )
}

type LayoutViewProps = NowPlayingLayoutProps & { size: number }

/**
 * On a wide screen: on the left, the player, as wide as the cover, scrolled where it stands
 * taller than the screen; on the right, the pane, its queue or its lyrics filling the column.
 */
const Columns = (props: LayoutViewProps) => {
  const { size, onBack } = props
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
        <Playing {...props} />
      </ScrollView>
      <View style={own.right}>
        <Pane {...props} isWide />
      </View>
    </View>
  )
}

/** A phone: the player across the screen, then the pane, its tabs switched in place. */
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
        <Playing {...props} />
      </View>
      <Pane {...props} isWide={false} />
    </TouchPage>
  )
}

const LAYOUT_VIEWS = {
  [PLAYING_LAYOUTS.columns]: Columns,
  [PLAYING_LAYOUTS.stacked]: Stacked,
} as const satisfies Record<PlayingLayout, ComponentType<LayoutViewProps>>

/**
 * Now Playing under the thumb, its controls grouped by what they do: the player (the cover, the
 * track with its heart and Add to playlist, its quality, the seek bar and the transport) and a
 * pane of two tabs, Up next with Shuffle, Repeat and Clear, and the lyrics or a book's
 * chapters. On an iPad the pane stands beside the player; on a phone it follows it in one
 * column to scroll. No volume: the device's own buttons set it.
 */
export const NowPlayingLayout = (props: NowPlayingLayoutProps) => {
  const { width, height } = useWindowDimensions()
  const layout = layoutOf(isTablet({ width, height }))
  const Layout = LAYOUT_VIEWS[layout]
  return <Layout {...props} size={coverSizeOf({ layout, width })} />
}
