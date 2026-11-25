import { LYRICS_KINDS } from '@raven/core'
import { type ComponentRef, type ComponentType, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { BUTTON_TONES } from '@raven/native/headless'

import { FocusBand } from '@/layouts/FocusBand'
import { useOpeningFocus } from '@/layouts/focus'
import { MUSIC_COPY } from '@/layouts/copy'
import {
  type BookControls,
  NOW_PLAYING_ASIDES,
  type NowPlayingAside as Aside,
  SPEED_OPTIONS,
  speedChooserOf,
} from '@/layouts/musicKit'
import { ActionPlate, FocusRow, useMusicStyles } from '@/layouts/MusicParts.focus'
import type { LyricsView, SyncedLyrics } from '@/layouts/musicRows'
import { focusPicker } from '@/layouts/Picker.focus'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { useLineInView } from '@/layouts/useLineInView'
import { LINE_RATIO } from '@/layouts/textHeights'
import { useLastFocus } from '@/stores/lastFocus'
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

const { Picker } = focusPicker

/**
 * How much of the screen's height the synced lyrics' box takes, so the line sung keeps to the
 * middle of it under the pane's tabs.
 */
const LYRICS_SHARE = 0.64

/** How large the lyrics are drawn: beside the player, or large once the remote has opened them. */
export const LYRIC_SIZES = { normal: 'normal', large: 'large' } as const

export type LyricSize = (typeof LYRIC_SIZES)[keyof typeof LYRIC_SIZES]

/** The lyrics' type at each size: larger than the page's, in the display face. */
const LYRIC_POINTS = {
  [LYRIC_SIZES.normal]: TV_SIZES.textXl * 1.25,
  [LYRIC_SIZES.large]: TV_SIZES.textXl * 1.85,
} as const satisfies Record<LyricSize, number>

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    lyricLines: { gap: TV_SIZES.space3, paddingVertical: TV_SIZES.space4 },
    lyric: { color: colours.muted },
    [LYRIC_SIZES.normal]: {
      fontSize: LYRIC_POINTS.normal,
      lineHeight: LYRIC_POINTS.normal * LINE_RATIO,
    },
    [LYRIC_SIZES.large]: {
      fontSize: LYRIC_POINTS.large,
      lineHeight: LYRIC_POINTS.large * LINE_RATIO,
    },
    lyricOn: { color: colours.text },
    fill: { flex: 1 },
    // The lyrics as one plate the remote reaches from the tabs, ringed while it has them.
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

type BookSkipsProps = { aside: Aside }

/**
 * An audiobook's own controls on a TV, a band under the transport: the chapter before and
 * after, and the speed's list. The last chapter has none after it, so it draws no Next.
 */
export const BookSkips = ({ aside }: BookSkipsProps) => {
  const styles = useMusicStyles()
  return (
    aside.kind === NOW_PLAYING_ASIDES.book && (
      <FocusBand>
        <View style={styles.actions}>
          <ActionPlate
            icon={APP_ICONS.rewind}
            isPreferred={false}
            label={MUSIC_COPY.previousChapter}
            onPress={aside.book.onPreviousChapter}
            text={null}
            tone={BUTTON_TONES.quiet}
          />
          {aside.book.onNextChapter !== null && (
            <ActionPlate
              icon={APP_ICONS.forward}
              isPreferred={false}
              label={MUSIC_COPY.nextChapter}
              onPress={aside.book.onNextChapter}
              text={null}
              tone={BUTTON_TONES.quiet}
            />
          )}
          <Picker
            icon={APP_ICONS.gauge}
            label={MUSIC_COPY.speed}
            onChoose={speedChooserOf(aside.book.onSpeed)}
            options={SPEED_OPTIONS}
            value={String(aside.book.speed)}
          />
        </View>
      </FocusBand>
    )
  )
}

type ChaptersProps = { book: BookControls }

/** An audiobook's chapters, to move down through and play from, scrolled in the pane. */
const Chapters = ({ book }: ChaptersProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  return (
    <ScrollView style={own.fill}>
      <FocusBand>
        <View style={styles.section}>
          {book.chapters.length === 0 && <Text style={styles.muted}>{MUSIC_COPY.noChapters}</Text>}
          {book.chapters.map((chapter) => (
            <FocusRow
              key={chapter.key}
              isSelected={chapter.isCurrent}
              label={chapter.label}
              onPress={() => book.onChapter(chapter.start)}
            >
              <Text numberOfLines={1} style={[styles.rowTitle, chapter.isCurrent && styles.on]}>
                {chapter.title}
              </Text>
              <Text style={styles.muted}>{chapter.at}</Text>
            </FocusRow>
          ))}
        </View>
      </FocusBand>
    </ScrollView>
  )
}

type SyncedLinesProps = { lyrics: SyncedLyrics; size: LyricSize }

/**
 * Lines timed to the music in a box of their own, the one sung marked and kept in its middle.
 * Nothing in it takes the remote's focus; the box scrolls by itself.
 */
const SyncedLines = ({ lyrics, size }: SyncedLinesProps) => {
  const styles = useStyles()
  const screen = useWindowDimensions()
  const { scroll, onBoxLayout, lineLayoutOf } = useLineInView({ current: lyrics.current })
  return (
    <ScrollView
      ref={scroll}
      accessibilityLabel={MUSIC_COPY.lyrics}
      contentContainerStyle={styles.lyricLines}
      onLayout={onBoxLayout}
      scrollEnabled={false}
      style={{ height: screen.height * LYRICS_SHARE }}
    >
      {lyrics.lines.map((line, place) => (
        <Text
          key={line.key}
          variant={TEXT_VARIANTS.display}
          accessibilityState={{ selected: line.isCurrent }}
          onLayout={lineLayoutOf(place)}
          style={[styles.lyric, styles[size], line.isCurrent && styles.lyricOn]}
        >
          {line.text}
        </Text>
      ))}
    </ScrollView>
  )
}

type LyricsBodyProps = { lyrics: LyricsView; size: LyricSize }

type SyncedBodyProps = LyricsBodyProps

const SyncedBody = ({ lyrics, size }: SyncedBodyProps) =>
  lyrics.kind === LYRICS_KINDS.synced && <SyncedLines lyrics={lyrics} size={size} />

type PlainBodyProps = LyricsBodyProps

const PlainBody = ({ lyrics, size }: PlainBodyProps) => {
  const styles = useStyles()
  return (
    lyrics.kind === LYRICS_KINDS.plain && (
      <Text variant={TEXT_VARIANTS.display} style={[styles.lyric, styles[size], styles.lyricOn]}>
        {lyrics.text}
      </Text>
    )
  )
}

const NoLyrics = () => {
  const styles = useMusicStyles()
  return <Text style={styles.muted}>{MUSIC_COPY.noLyrics}</Text>
}

/** The words in each shape they come in. */
const LYRICS_BODIES = {
  [LYRICS_KINDS.synced]: SyncedBody,
  [LYRICS_KINDS.plain]: PlainBody,
  [LYRICS_KINDS.none]: NoLyrics,
} as const satisfies Record<LyricsView['kind'], ComponentType<LyricsBodyProps>>

/** The words themselves: timed lines, plain text, or a quiet word that there are none. */
const LyricsBody = ({ lyrics, size }: LyricsBodyProps) => {
  const Body = LYRICS_BODIES[lyrics.kind]
  return <Body lyrics={lyrics} size={size} />
}

type NowPlayingAsideProps = {
  aside: Aside
  /** How large the lyrics are drawn; a select on their plate switches between the two. */
  size: LyricSize
  onLyricSize: () => void
}

type BookAsideProps = NowPlayingAsideProps

/** A book's chapters stand in the pane as they are; the remote moves down through them. */
const BookAside = ({ aside }: BookAsideProps) =>
  aside.kind === NOW_PLAYING_ASIDES.book && <Chapters book={aside.book} />

type LyricsAsideProps = NowPlayingAsideProps

/*
 * The lyrics as one plate the remote reaches with Down from the tabs: ringed while it has the
 * focus, a select makes them large and the player small, another select puts them back. Its
 * band fills the column, since a band sized by its content gives the plate's `flex: 1` no
 * height, and Android, which clips a view's children to it, then draws no lyrics at all.
 */
const LyricsAside = ({ aside, size, onLyricSize }: LyricsAsideProps) => {
  const view = useRef<ComponentRef<typeof Pressable>>(null)
  const { settle } = useOpeningFocus()
  const note = useLastFocus((state) => state.note)
  const styles = useMusicStyles()
  const own = useStyles()
  const isLarge = size === LYRIC_SIZES.large
  return (
    aside.kind === NOW_PLAYING_ASIDES.lyrics && (
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
          onPress={onLyricSize}
          style={({ focused }) => [own.lyricsPlate, focused && own.lyricsFocused]}
        >
          <View style={styles.section}>
            <LyricsBody lyrics={aside.lyrics} size={size} />
          </View>
        </Pressable>
      </FocusBand>
    )
  )
}

const NoAside = () => null

/** What each kind of aside draws. */
const ASIDES = {
  [NOW_PLAYING_ASIDES.book]: BookAside,
  [NOW_PLAYING_ASIDES.lyrics]: LyricsAside,
  [NOW_PLAYING_ASIDES.none]: NoAside,
} as const satisfies Record<Aside['kind'], ComponentType<NowPlayingAsideProps>>

/**
 * What the pane's second tab holds on a TV: a book's chapters, or the lyrics on their plate,
 * which a select makes large or puts back.
 */
export const NowPlayingAside = ({ aside, size, onLyricSize }: NowPlayingAsideProps) => {
  const AsideView = ASIDES[aside.kind]
  return <AsideView aside={aside} onLyricSize={onLyricSize} size={size} />
}
