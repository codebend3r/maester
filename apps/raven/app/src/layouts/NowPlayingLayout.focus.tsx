import { type QueueRow, formatDuration, remainingTimeOf } from '@raven/core'
import { usePlayerPrefs } from '@raven/ui/headless'
import { type ComponentType, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { BUTTON_TONES } from '@raven/native/headless'

import { FocusBand } from '@/layouts/FocusBand'
import { HomePlate } from '@/layouts/HomePlate.focus'
import { useScreenFocusScope } from '@/layouts/focus'
import { MUSIC_COPY } from '@/layouts/copy'
import {
  CROSSFADE_OPTIONS,
  NOW_PLAYING_ASIDES,
  type NowPlayingAside as Aside,
  type NowPlayingLayoutProps,
  PLAYING_PANES,
  PLAYING_STATES,
  PLAYLIST_PICKS,
  type PlayingPane,
  type PlayingState,
  crossfadeChooserOf,
  paneTabsOf,
  playingStateOf,
  toggleLabelOf,
} from '@/layouts/musicKit'
import { playModesOf, queueLineOf } from '@/layouts/musicRows'
import {
  BookSkips,
  LYRIC_SIZES,
  type LyricSize,
  NowPlayingAside,
} from '@/layouts/NowPlayingAside.focus'
import { ActionPlate, FocusRow, TogglePlate, useMusicStyles } from '@/layouts/MusicParts.focus'
import { PickerList, usePickerList } from '@/layouts/Picker.focus'
import { PlayingCover } from '@/layouts/PlayingCover.focus'
import { FocusQualityLine } from '@/layouts/QualityLine'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { TvSheet, useSheetStyles } from '@/layouts/TvSheet.focus'
import { usePlateStyles } from '@/layouts/tvControls'
import { TV_GUTTER, TV_SIZES, tvSize } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

/**
 * How wide the cover stands, and with it the column under it: beside the pane, and small once
 * the lyrics are made large.
 */
const COVER_SIZES = {
  [LYRIC_SIZES.normal]: tvSize(384),
  [LYRIC_SIZES.large]: tvSize(240),
} as const satisfies Record<LyricSize, number>

type LyricSizeOfProps = { aside: Aside; pane: PlayingPane; isLyricsLarge: boolean }

/**
 * How large the lyrics are drawn, and with it how wide the player stands: large, and the
 * player small, once the remote has opened them and for as long as their tab is the one shown.
 */
const lyricSizeOf = ({ aside, pane, isLyricsLarge }: LyricSizeOfProps): LyricSize => {
  const isOnLyrics = pane === PLAYING_PANES.extras && aside.kind === NOW_PLAYING_ASIDES.lyrics
  return isOnLyrics && isLyricsLarge ? LYRIC_SIZES.large : LYRIC_SIZES.normal
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    error: { color: colours.error, fontSize: TV_SIZES.text },
    time: { color: colours.muted, fontSize: TV_SIZES.text, fontVariant: ['tabular-nums'] },
    // Where the track is: the time played, the line, and the time left.
    progress: { flexDirection: 'row', alignItems: 'center', gap: TV_SIZES.space2 },
    rail: {
      flex: 1,
      height: TV_SIZES.space1,
      borderRadius: TV_SIZES.space1,
      backgroundColor: colours.quiet,
      overflow: 'hidden',
    },
    played: { height: '100%', backgroundColor: colours.accent },
    queueHead: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: TV_SIZES.space3,
    },
    queueFacts: { flexGrow: 1 },
    entryWords: { flex: 1, gap: TV_SIZES.space0 },
    // What plays on the left, the pane taking the rest of the width.
    columns: {
      flex: 1,
      flexDirection: 'row',
      gap: TV_SIZES.space8,
      paddingHorizontal: TV_GUTTER,
    },
    left: { flexGrow: 0 },
    leftPage: { gap: TV_SIZES.space5, paddingVertical: TV_SIZES.space6 },
    playing: { gap: TV_SIZES.space4 },
    words: { gap: TV_SIZES.space2 },
    // Outside the player's scroll, so moving down the left never moves the pane.
    pane: { flex: 1, gap: TV_SIZES.space3, paddingTop: TV_SIZES.space6, overflow: 'hidden' },
    fill: { flex: 1 },
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
          {queueLineOf(row)}
        </Text>
      </View>
    </FocusRow>
  )
}

/** The crossfade length on a plate, which opens the TV's list of lengths; the choice is the player preferences'. */
const CrossfadePlate = () => {
  const crossfade = usePlayerPrefs((prefs) => prefs.crossfade)
  const setCrossfade = usePlayerPrefs((prefs) => prefs.setCrossfade)
  const { open, label, list } = usePickerList({
    label: MUSIC_COPY.crossfade,
    options: CROSSFADE_OPTIONS,
    value: String(crossfade),
    onChoose: crossfadeChooserOf(setCrossfade),
  })
  return (
    <>
      <TogglePlate
        icon={APP_ICONS.crossfade}
        isOn={crossfade > 0}
        isPreferred={false}
        label={label}
        onPress={open}
        text={null}
      />
      <PickerList {...list} />
    </>
  )
}

type PlayedLineProps = Pick<NowPlayingLayoutProps, 'position' | 'duration'>

/*
 * Where the track is, which a TV shows and never drags: the time played at the line's start
 * and the time left, with a minus before it, at its end. Empty until the length is known.
 */
const PlayedLine = ({ position, duration }: PlayedLineProps) => {
  const own = useStyles()
  const length = duration ?? 0
  const share = length > 0 ? Math.min(position / length, 1) : 0
  return (
    <View style={own.progress}>
      <Text style={own.time}>{formatDuration(position)}</Text>
      <View style={own.rail}>
        <View style={[own.played, { width: `${share * 100}%` }]} />
      </View>
      <Text style={own.time}>{remainingTimeOf({ position, length })}</Text>
    </View>
  )
}

type PlaylistPlateProps = Pick<NowPlayingLayoutProps, 'playlists' | 'onAddToPlaylist'> & {
  title: string
}

/**
 * Add to playlist on a plate, which opens a sheet of the account's playlists with the remote on
 * the first; choosing one adds the playing track and closes it. A TV has no way to name a new
 * playlist, so the plate is drawn only once the account has one to add to.
 */
const PlaylistPlate = ({ playlists, onAddToPlaylist, title }: PlaylistPlateProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const sheetStyles = useSheetStyles()
  const plateStyles = usePlateStyles()
  return (
    playlists.length > 0 && (
      <>
        <ActionPlate
          icon={APP_ICONS.list}
          isPreferred={false}
          label={MUSIC_COPY.addToPlaylist}
          onPress={() => setIsOpen(true)}
          text={null}
          tone={BUTTON_TONES.quiet}
        />
        {isOpen && (
          <TvSheet onClose={() => setIsOpen(false)} title={MUSIC_COPY.addTrackToPlaylist(title)}>
            <ScrollView contentContainerStyle={sheetStyles.options}>
              {playlists.map((playlist, index) => (
                <Pressable
                  key={playlist.id}
                  accessibilityLabel={playlist.name}
                  accessibilityRole="button"
                  hasTVPreferredFocus={index === 0}
                  onPress={() => {
                    setIsOpen(false)
                    onAddToPlaylist({
                      kind: PLAYLIST_PICKS.existing,
                      playlistId: playlist.id,
                      name: playlist.name,
                    })
                  }}
                  style={({ focused }) => [sheetStyles.option, focused && sheetStyles.focused]}
                >
                  <Text style={plateStyles.label}>{playlist.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </TvSheet>
        )}
      </>
    )
  )
}

type PlayerProps = NowPlayingLayoutProps & { isOpening: boolean; size: number }

/*
 * What plays, in groups the remote moves down through: the cover with the equalizer over it;
 * the track's words, its format and quality and where it is; Previous, Play or Pause and Next
 * alone in their row, opening on Play or Pause; a book's own skips; then the track's own
 * actions, its heart and Add to playlist.
 */
const Player = ({
  track,
  error,
  quality,
  heart,
  position,
  duration,
  isPlaying,
  onToggle,
  onPrevious,
  onNext,
  aside,
  playlists,
  onAddToPlaylist,
  note,
  isOpening,
  size,
}: PlayerProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  return (
    track !== null && (
      <View style={[own.playing, { width: size }]}>
        <FocusBand>
          <PlayingCover cover={track.cover} isPlaying={isPlaying} size={size} title={track.title} />
        </FocusBand>
        <View style={own.words}>
          <Text variant={TEXT_VARIANTS.display} numberOfLines={2} style={styles.title}>
            {track.title}
          </Text>
          <Text numberOfLines={1} style={styles.line}>
            {track.artists}
          </Text>
          <Text numberOfLines={1} style={styles.muted}>
            {track.album}
          </Text>
          {quality !== null && <FocusQualityLine quality={quality} />}
          {error !== null && <Text style={own.error}>{error}</Text>}
        </View>
        <PlayedLine duration={duration} position={position} />
        <FocusBand>
          <View style={styles.actions}>
            <ActionPlate
              icon={APP_ICONS.skipPrevious}
              isPreferred={false}
              label={MUSIC_COPY.previous}
              onPress={onPrevious}
              text={null}
              tone={BUTTON_TONES.quiet}
            />
            <ActionPlate
              icon={isPlaying ? APP_ICONS.pause : APP_ICONS.play}
              isPreferred={isOpening}
              label={toggleLabelOf(isPlaying)}
              onPress={onToggle}
              text={null}
              tone={BUTTON_TONES.primary}
            />
            <ActionPlate
              icon={APP_ICONS.skipNext}
              isPreferred={false}
              label={MUSIC_COPY.next}
              onPress={onNext}
              text={null}
              tone={BUTTON_TONES.quiet}
            />
          </View>
        </FocusBand>
        <BookSkips aside={aside} />
        <FocusBand>
          <View style={styles.actions}>
            {heart}
            <PlaylistPlate
              onAddToPlaylist={onAddToPlaylist}
              playlists={playlists}
              title={track.title}
            />
          </View>
        </FocusBand>
        {note !== null && <Text style={styles.muted}>{note}</Text>}
      </View>
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
  [PLAYING_STATES.playing]: Player,
} as const satisfies Record<PlayingState, ComponentType<PlayerProps>>

type PaneViewProps = NowPlayingLayoutProps & {
  /** How large the lyrics are drawn; a select on their plate switches between the two. */
  lyricSize: LyricSize
  onLyricSize: () => void
}

/*
 * Up next: how much is queued, with what changes how it plays beside it, Shuffle, Repeat
 * (`repeat`, or `repeatOne` for one track) and Crossfade as icons, and Clear; then the queue,
 * to move down through and play from, scrolled in the pane.
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
}: PaneViewProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  const modes = playModesOf({ isShuffled, repeat })
  return (
    <>
      <FocusBand>
        <View style={own.queueHead}>
          <Text numberOfLines={1} style={[styles.muted, own.queueFacts]}>
            {queueFacts}
          </Text>
          <TogglePlate
            icon={APP_ICONS.shuffle}
            isOn={modes.shuffle.isOn}
            isPreferred={false}
            label={modes.shuffle.label}
            onPress={onShuffle}
            text={null}
          />
          <TogglePlate
            icon={modes.repeat.icon}
            isOn={modes.repeat.isOn}
            isPreferred={false}
            label={modes.repeat.label}
            onPress={onRepeat}
            text={null}
          />
          <CrossfadePlate />
          <ActionPlate
            icon={null}
            isPreferred={false}
            label={MUSIC_COPY.clear}
            onPress={onClear}
            text={MUSIC_COPY.clear}
            tone={BUTTON_TONES.ghost}
          />
        </View>
      </FocusBand>
      <ScrollView style={own.fill}>
        <FocusBand>
          <View style={styles.section}>
            {queue.map((row) => (
              <QueueEntry key={row.key} onJump={onJump} row={row} />
            ))}
          </View>
        </FocusBand>
      </ScrollView>
    </>
  )
}

/** The other tab: the lyrics on their plate, or a book's chapters. */
const ExtrasPane = ({ aside, lyricSize, onLyricSize }: PaneViewProps) => (
  <NowPlayingAside aside={aside} onLyricSize={onLyricSize} size={lyricSize} />
)

const PANE_VIEWS = {
  [PLAYING_PANES.queue]: QueuePane,
  [PLAYING_PANES.extras]: ExtrasPane,
} as const satisfies Record<PlayingPane, ComponentType<PaneViewProps>>

type PaneTabsProps = { aside: Aside; pane: PlayingPane; onPane: (pane: PlayingPane) => void }

/** The pane's two tabs as plates in a band of their own, the one shown filled in the primary tone. */
const PaneTabs = ({ aside, pane, onPane }: PaneTabsProps) => {
  const styles = useMusicStyles()
  return (
    <FocusBand>
      <View
        accessibilityLabel={MUSIC_COPY.panes}
        accessibilityRole="tablist"
        style={styles.actions}
      >
        {paneTabsOf(aside).map((tab) => (
          <TogglePlate
            key={tab.pane}
            icon={null}
            isOn={pane === tab.pane}
            isPreferred={false}
            label={tab.label}
            onPress={() => onPane(tab.pane)}
            text={tab.label}
          />
        ))}
      </View>
    </FocusBand>
  )
}

/**
 * Now Playing on a TV, its controls grouped by what they do, in the order the remote meets
 * them. On the left, the one column that scrolls, as wide as the cover: the player, opening on
 * Play or Pause beside Previous and Next, then the track's own actions under them. On the
 * right, fixed, a pane of two tabs Right reaches: Up next, the queue under Shuffle, Repeat,
 * Crossfade and Clear, and the lyrics, which a select makes large, or a book's chapters. Menu
 * goes back. It is one tree in both looks, so a change of look (the lyrics made large) never
 * mounts the player afresh and asks the opening focus again. No volume: the TV's own sets it.
 */
export const NowPlayingLayout = (props: NowPlayingLayoutProps) => {
  const { track, aside } = props
  const { isOpening } = useScreenFocusScope()
  const [pane, setPane] = useState<PlayingPane>(PLAYING_PANES.queue)
  const [isLyricsLarge, setLyricsLarge] = useState(false)
  const styles = useMusicStyles()
  const own = useStyles()
  const lyricSize = lyricSizeOf({ aside, pane, isLyricsLarge })
  const size = COVER_SIZES[lyricSize]
  const Playing = PLAYING_VIEWS[playingStateOf(track)]
  const PaneView = PANE_VIEWS[pane]
  return (
    <View style={[styles.ground, own.columns]}>
      <ScrollView contentContainerStyle={own.leftPage} style={[own.left, { width: size }]}>
        <HomePlate />
        <Text accessibilityRole="header" style={styles.eyebrow}>
          {MUSIC_COPY.nowPlaying}
        </Text>
        <Playing {...props} isOpening={isOpening} size={size} />
      </ScrollView>
      {track !== null && (
        <View style={own.pane}>
          <PaneTabs aside={aside} onPane={setPane} pane={pane} />
          <PaneView
            {...props}
            lyricSize={lyricSize}
            onLyricSize={() => setLyricsLarge((was) => !was)}
          />
        </View>
      )}
    </View>
  )
}
