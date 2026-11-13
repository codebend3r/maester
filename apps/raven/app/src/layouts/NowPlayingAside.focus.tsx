import { LYRICS_KINDS } from '@raven/core'
import type { ComponentType } from 'react'
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { BUTTON_TONES } from '@raven/native/headless'

import { FocusBand } from '@/layouts/FocusBand'
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
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

const { Picker } = focusPicker

/**
 * How much of the screen's height the synced lyrics' box takes, so the line sung keeps to the
 * middle of it beside the cover and the controls.
 */
const LYRICS_SHARE = 0.72

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
  }),
)

type BookProps = { book: BookControls }

/**
 * An audiobook's controls on a TV, a band below the player's: the chapter before and after and
 * the speed's list, then the chapters to move down through and play from.
 */
const Book = ({ book }: BookProps) => {
  const styles = useMusicStyles()
  const { onNextChapter } = book
  return (
    <>
      <FocusBand>
        <View style={styles.actions}>
          <ActionPlate
            icon={APP_ICONS.rewind}
            isPreferred={false}
            label={MUSIC_COPY.previousChapter}
            onPress={book.onPreviousChapter}
            text={MUSIC_COPY.previousChapter}
            tone={BUTTON_TONES.quiet}
          />
          {onNextChapter !== null && (
            <ActionPlate
              icon={APP_ICONS.forward}
              isPreferred={false}
              label={MUSIC_COPY.nextChapter}
              onPress={onNextChapter}
              text={MUSIC_COPY.nextChapter}
              tone={BUTTON_TONES.quiet}
            />
          )}
          <Picker
            icon={APP_ICONS.gauge}
            label={MUSIC_COPY.speed}
            onChoose={speedChooserOf(book.onSpeed)}
            options={SPEED_OPTIONS}
            value={String(book.speed)}
          />
        </View>
      </FocusBand>
      <FocusBand>
        <View style={styles.section}>
          <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.heading}>
            {MUSIC_COPY.chapters}
          </Text>
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
    </>
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

type NowPlayingAsideProps = { aside: Aside; size: LyricSize }

type BookAsideProps = NowPlayingAsideProps

const BookAside = ({ aside }: BookAsideProps) =>
  aside.kind === NOW_PLAYING_ASIDES.book && <Book book={aside.book} />

type LyricsAsideProps = NowPlayingAsideProps

const LyricsAside = ({ aside, size }: LyricsAsideProps) => {
  const styles = useMusicStyles()
  return (
    aside.kind === NOW_PLAYING_ASIDES.lyrics && (
      <View style={styles.section}>
        <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.heading}>
          {MUSIC_COPY.lyrics}
        </Text>
        <LyricsBody lyrics={aside.lyrics} size={size} />
      </View>
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

/** What stands fixed beside Now Playing's column on a TV: a book's controls, or the lyrics under a heading. */
export const NowPlayingAside = ({ aside, size }: NowPlayingAsideProps) => {
  const AsideView = ASIDES[aside.kind]
  return <AsideView aside={aside} size={size} />
}
