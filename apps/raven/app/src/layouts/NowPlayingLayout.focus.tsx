import { REPEAT_MODES, type QueueRow } from '@raven/core'
import { usePlayerPrefs } from '@raven/ui/headless'
import { type ComponentRef, type ComponentType, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { BUTTON_TONES } from '@raven/native/headless'

import { FocusBand } from '@/layouts/FocusBand'
import { HomePlate } from '@/layouts/HomePlate.focus'
import { useOpeningFocus, useScreenFocusScope } from '@/layouts/focus'
import { MUSIC_COPY } from '@/layouts/copy'
import {
  CROSSFADE_OPTIONS,
  NOW_PLAYING_ASIDES,
  type NowPlayingAside as Aside,
  type NowPlayingLayoutProps,
  PLAYING_STATES,
  type PlayingState,
  crossfadeChooserOf,
  isCentredFor,
  playingStateOf,
  repeatIconOf,
  shuffleLabelOf,
  toggleLabelOf,
} from '@/layouts/musicKit'
import { LYRIC_SIZES, type LyricSize, NowPlayingAside } from '@/layouts/NowPlayingAside.focus'
import { ActionPlate, FocusRow, useMusicStyles } from '@/layouts/MusicParts.focus'
import { PickerList, usePickerList } from '@/layouts/Picker.focus'
import { PlayingCover } from '@/layouts/PlayingCover.focus'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { useLastFocus } from '@/stores/lastFocus'
import { TV_GUTTER, TV_SIZES, tvSize } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

/**
 * How wide the cover stands, and with it the column under it, in each layout: beside the
 * lyrics or a book's controls; small once the lyrics are made large; and large, dead centre,
 * for a track with no lyrics.
 */
const COVER_SIZES = { columns: tvSize(384), narrow: tvSize(240), centred: tvSize(560) } as const

/** Which of the three layouts Now Playing takes. */
const PLAYING_LAYOUTS = {
  columns: 'columns',
  lyricsLarge: 'lyricsLarge',
  centred: 'centred',
} as const

type PlayingLayout = (typeof PLAYING_LAYOUTS)[keyof typeof PLAYING_LAYOUTS]

type LayoutOfProps = { aside: Aside; isLyricsLarge: boolean }

/**
 * Lyrics or a book's controls stand beside the player in two columns, the lyrics large once
 * the remote has opened them; a track with no lyrics puts the player dead centre.
 */
const layoutOf = ({ aside, isLyricsLarge }: LayoutOfProps): PlayingLayout => {
  if (isCentredFor(aside)) return PLAYING_LAYOUTS.centred
  const isLyrics = aside.kind === NOW_PLAYING_ASIDES.lyrics
  return isLyrics && isLyricsLarge ? PLAYING_LAYOUTS.lyricsLarge : PLAYING_LAYOUTS.columns
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    error: { color: colours.error, fontSize: TV_SIZES.text },
    time: { color: colours.muted, fontSize: TV_SIZES.text, fontVariant: ['tabular-nums'] },
    queueHead: { flexDirection: 'row', alignItems: 'center', gap: TV_SIZES.space4 },
    entryWords: { flex: 1, gap: TV_SIZES.space0 },
    // What plays on the left, the lyrics or a book's controls taking the rest of the width.
    columns: {
      flex: 1,
      flexDirection: 'row',
      gap: TV_SIZES.space8,
      paddingHorizontal: TV_GUTTER,
    },
    left: { flexGrow: 0 },
    wholeWidth: { flex: 1 },
    leftPage: { gap: TV_SIZES.space5, paddingVertical: TV_SIZES.space6 },
    centred: { alignItems: 'center' },
    playing: { gap: TV_SIZES.space4 },
    words: { gap: TV_SIZES.space2 },
    centredWords: { alignItems: 'center' },
    centredText: { textAlign: 'center' },
    // Outside any scroll, so moving down the left column never moves the lyrics.
    aside: { flex: 1, paddingTop: TV_SIZES.space6, overflow: 'hidden' },
    // The lyrics as one plate the remote reaches with Right, ringed while it has them.
    lyricsPlate: {
      flex: 1,
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: 'transparent',
      padding: TV_SIZES.space4,
    },
    lyricsFocused: { borderColor: colours.text, backgroundColor: colours.raised },
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
      <ActionPlate
        icon={APP_ICONS.crossfade}
        isOn={crossfade > 0}
        isPreferred={false}
        label={label}
        onPress={open}
        text={null}
        tone={crossfade > 0 ? BUTTON_TONES.primary : BUTTON_TONES.quiet}
      />
      <PickerList {...list} />
    </>
  )
}

type PlayerProps = NowPlayingLayoutProps & {
  isOpening: boolean
  size: number
  isCentred: boolean
}

/**
 * What plays: the cover with the equalizer over it, under it its words, and the controls, Play
 * or Pause first; Previous, Pause and Next, then Shuffle, Repeat and Crossfade as their icons.
 * Centred, for a track with no lyrics, the whole stands in the middle of the screen.
 */
const Player = ({
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
  size,
  isCentred,
}: PlayerProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  return (
    track !== null && (
      <View
        style={[own.playing, { width: isCentred ? undefined : size }, isCentred && own.centred]}
      >
        <FocusBand>
          <PlayingCover cover={track.cover} size={size} title={track.title} />
        </FocusBand>
        <View style={[own.words, isCentred && own.centredWords]}>
          <Text
            variant={TEXT_VARIANTS.display}
            numberOfLines={2}
            style={[styles.title, isCentred && own.centredText]}
          >
            {track.title}
          </Text>
          <Text numberOfLines={1} style={[styles.line, isCentred && own.centredText]}>
            {track.artists}
          </Text>
          <Text numberOfLines={1} style={[styles.muted, isCentred && own.centredText]}>
            {track.album}
          </Text>
          {error !== null && <Text style={own.error}>{error}</Text>}
          <Text style={[own.time, isCentred && own.centredText]}>{time}</Text>
        </View>
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
            <ActionPlate
              icon={APP_ICONS.shuffle}
              isOn={isShuffled}
              isPreferred={false}
              label={shuffleLabelOf(isShuffled)}
              onPress={onShuffle}
              text={null}
              tone={isShuffled ? BUTTON_TONES.primary : BUTTON_TONES.quiet}
            />
            <ActionPlate
              icon={repeatIconOf(repeat)}
              isOn={repeat !== REPEAT_MODES.off}
              isPreferred={false}
              label={MUSIC_COPY.repeat[repeat]}
              onPress={onRepeat}
              text={null}
              tone={repeat === REPEAT_MODES.off ? BUTTON_TONES.quiet : BUTTON_TONES.primary}
            />
            <CrossfadePlate />
          </View>
        </FocusBand>
      </View>
    )
  )
}

type NothingPlayingProps = PlayerProps

const NothingPlaying = (_props: NothingPlayingProps) => {
  const styles = useMusicStyles()
  return <Text style={styles.line}>{MUSIC_COPY.nothingPlaying}</Text>
}

/** What stands under the heading: what plays, or a word that nothing does. */
const PLAYING_VIEWS = {
  [PLAYING_STATES.idle]: NothingPlaying,
  [PLAYING_STATES.playing]: Player,
} as const satisfies Record<PlayingState, ComponentType<PlayerProps>>

type QueueProps = Pick<NowPlayingLayoutProps, 'queue' | 'onClear' | 'onJump'>

/** Up next, to move down through and play from, with Clear beside its heading. */
const Queue = ({ queue, onClear, onJump }: QueueProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  return (
    queue.length > 0 && (
      <FocusBand>
        <View style={styles.section}>
          <View style={own.queueHead}>
            <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.heading}>
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
    )
  )
}

type AsideColumnProps = {
  aside: Aside
  /** How large the lyrics are drawn; a select on the plate switches between the two. */
  size: LyricSize
  onToggle: () => void
}

/**
 * The lyrics as one plate the remote reaches with Right from the controls: ringed while it has
 * the focus, a select makes them large and the player small, another select puts them back,
 * and Up from them reaches Home at the top.
 */
const LyricsPlate = ({ aside, size, onToggle }: AsideColumnProps) => {
  const view = useRef<ComponentRef<typeof Pressable>>(null)
  const { settle } = useOpeningFocus()
  const note = useLastFocus((state) => state.note)
  const own = useStyles()
  const isLarge = size === LYRIC_SIZES.large
  return (
    <FocusBand isFilling>
      <Pressable
        ref={view}
        accessibilityLabel={isLarge ? MUSIC_COPY.lyricsShrink : MUSIC_COPY.lyricsEnlarge}
        accessibilityRole="button"
        accessibilityState={{ expanded: isLarge }}
        onFocus={() => {
          note(view.current)
          settle()
        }}
        onPress={onToggle}
        style={({ focused }) => [own.lyricsPlate, focused && own.lyricsFocused]}
      >
        <NowPlayingAside aside={aside} size={size} />
      </Pressable>
    </FocusBand>
  )
}

/** A book's controls stand beside the player as they are; the remote moves through them. */
const BookColumn = ({ aside, size }: AsideColumnProps) => (
  <NowPlayingAside aside={aside} size={size} />
)

const NoColumn = (_props: AsideColumnProps) => null

/** What the right column draws for each kind of aside. */
const ASIDE_COLUMNS = {
  [NOW_PLAYING_ASIDES.book]: BookColumn,
  [NOW_PLAYING_ASIDES.lyrics]: LyricsPlate,
  [NOW_PLAYING_ASIDES.none]: NoColumn,
} as const satisfies Record<Aside['kind'], ComponentType<AsideColumnProps>>

type LayoutLook = { size: number; isCentred: boolean; lyricSize: LyricSize }

/** How wide the cover stands in each layout, whether the player stands centred, and how large the lyrics are. */
const LAYOUT_LOOKS = {
  [PLAYING_LAYOUTS.columns]: {
    size: COVER_SIZES.columns,
    isCentred: false,
    lyricSize: LYRIC_SIZES.normal,
  },
  [PLAYING_LAYOUTS.lyricsLarge]: {
    size: COVER_SIZES.narrow,
    isCentred: false,
    lyricSize: LYRIC_SIZES.large,
  },
  [PLAYING_LAYOUTS.centred]: {
    size: COVER_SIZES.centred,
    isCentred: true,
    lyricSize: LYRIC_SIZES.normal,
  },
} as const satisfies Record<PlayingLayout, LayoutLook>

/**
 * Now Playing on a TV. With lyrics, two columns: the player on the left, opening on Play or
 * Pause, the lyrics on the right, which Right reaches and a select makes large; with a book,
 * its controls on the right; with neither, the player dead centre. Menu goes back. It is one
 * tree in every layout, so a layout change (the lyrics arriving, or made large) never mounts
 * the player afresh and asks the opening focus again: on the left, the player and the queue,
 * the one column that scrolls, as wide as the cover, or the whole width with the player centred
 * for a track with no lyrics; on the right, fixed, the lyrics or a book's controls, where there
 * are any.
 */
export const NowPlayingLayout = (props: NowPlayingLayoutProps) => {
  const { track, queue, onClear, onJump, aside } = props
  const { isOpening } = useScreenFocusScope()
  const [isLyricsLarge, setLyricsLarge] = useState(false)
  const styles = useMusicStyles()
  const own = useStyles()
  const { size, isCentred, lyricSize } = LAYOUT_LOOKS[layoutOf({ aside, isLyricsLarge })]
  const Playing = PLAYING_VIEWS[playingStateOf(track)]
  const AsideColumn = ASIDE_COLUMNS[aside.kind]
  return (
    <View style={[styles.ground, own.columns]}>
      <ScrollView
        contentContainerStyle={[own.leftPage, isCentred && own.centred]}
        style={isCentred ? own.wholeWidth : [own.left, { width: size }]}
      >
        <HomePlate />
        <Text accessibilityRole="header" style={[styles.eyebrow, isCentred && own.centredText]}>
          {MUSIC_COPY.nowPlaying}
        </Text>
        <Playing {...props} isCentred={isCentred} isOpening={isOpening} size={size} />
        <Queue onClear={onClear} onJump={onJump} queue={queue} />
      </ScrollView>
      {!isCentred && (
        <View style={own.aside}>
          <AsideColumn
            aside={aside}
            onToggle={() => setLyricsLarge((was) => !was)}
            size={lyricSize}
          />
        </View>
      )}
    </View>
  )
}
