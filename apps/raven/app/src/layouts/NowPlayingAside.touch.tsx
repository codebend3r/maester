import { LYRICS_KINDS } from '@raven/core'
import type { ComponentType } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { BUTTON_TONES } from '@/layouts/formKit'
import { touchForm } from '@/layouts/Form.touch'
import { MUSIC_COPY } from '@/layouts/copy'
import {
  type BookControls,
  NOW_PLAYING_ASIDES,
  type NowPlayingAside as Aside,
  SPEED_OPTIONS,
  speedChooserOf,
} from '@/layouts/musicKit'
import { useMusicStyles } from '@/layouts/MusicParts.touch'
import type { LyricsView, SyncedLyrics } from '@/layouts/musicRows'
import { touchPicker } from '@/layouts/Picker.touch'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { useLineInView } from '@/layouts/useLineInView'
import { SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

const { FormButton } = touchForm
const { Picker } = touchPicker

/** How tall the synced lyrics' box stands on a phone, so the line sung keeps to the middle of it. */
const LYRICS_HEIGHT = SIZES.cover

/** The lyrics' type in their own column on a wide screen: larger, with room to read, as the TV's. */
const WIDE_LYRIC_POINTS = SIZES.textXl * 1.25

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    lyricBox: { maxHeight: LYRICS_HEIGHT },
    // Beside the player the lyrics fill their column's height.
    wideBox: { flex: 1 },
    lyricLines: { gap: SIZES.space2, paddingVertical: SIZES.space2 },
    wideLines: { gap: SIZES.space4, paddingVertical: SIZES.space4 },
    lyric: { color: colours.muted, fontSize: SIZES.textLg },
    wideLyric: { fontSize: WIDE_LYRIC_POINTS, lineHeight: WIDE_LYRIC_POINTS * 1.3 },
    lyricOn: { color: colours.text },
    plain: { color: colours.text, fontSize: SIZES.text },
  }),
)

type BookProps = { book: BookControls }

/** An audiobook's controls: the chapter before and after, the speed, and the chapters to jump to. */
const Book = ({ book }: BookProps) => {
  const styles = useMusicStyles()
  const { onNextChapter } = book
  return (
    <View style={styles.section}>
      <View style={styles.controls}>
        <FormButton
          label={MUSIC_COPY.previousChapter}
          onPress={book.onPreviousChapter}
          tone={BUTTON_TONES.quiet}
        />
        <FormButton
          isDisabled={onNextChapter === null}
          label={MUSIC_COPY.nextChapter}
          onPress={() => onNextChapter?.()}
          tone={BUTTON_TONES.quiet}
        />
        <Picker
          icon="gauge"
          label={MUSIC_COPY.speed}
          onChoose={speedChooserOf(book.onSpeed)}
          options={SPEED_OPTIONS}
          value={String(book.speed)}
        />
      </View>
      <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.heading}>
        {MUSIC_COPY.chapters}
      </Text>
      {book.chapters.length === 0 && <Text style={styles.muted}>{MUSIC_COPY.noChapters}</Text>}
      {book.chapters.map((chapter) => (
        <Pressable
          key={chapter.key}
          accessibilityLabel={chapter.label}
          accessibilityRole="button"
          accessibilityState={{ selected: chapter.isCurrent }}
          onPress={() => book.onChapter(chapter.start)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <Text
            numberOfLines={1}
            style={[styles.rowTitle, styles.grow, chapter.isCurrent && styles.on]}
          >
            {chapter.title}
          </Text>
          <Text style={styles.length}>{chapter.at}</Text>
        </Pressable>
      ))}
    </View>
  )
}

type SyncedLinesProps = { lyrics: SyncedLyrics; isWide: boolean }

/** Lines timed to the music in a box of their own, the one sung marked and kept in its middle. */
const SyncedLines = ({ lyrics, isWide }: SyncedLinesProps) => {
  const styles = useStyles()
  const { scroll, onBoxLayout, lineLayoutOf } = useLineInView({ current: lyrics.current })
  return (
    <ScrollView
      ref={scroll}
      accessibilityLabel={MUSIC_COPY.lyrics}
      contentContainerStyle={isWide ? styles.wideLines : styles.lyricLines}
      nestedScrollEnabled
      onLayout={onBoxLayout}
      style={isWide ? styles.wideBox : styles.lyricBox}
    >
      {lyrics.lines.map((line, place) => (
        <Text
          key={line.key}
          variant={TEXT_VARIANTS.display}
          accessibilityState={{ selected: line.isCurrent }}
          onLayout={lineLayoutOf(place)}
          style={[styles.lyric, isWide && styles.wideLyric, line.isCurrent && styles.lyricOn]}
        >
          {line.text}
        </Text>
      ))}
    </ScrollView>
  )
}

type LyricsBodyProps = { lyrics: LyricsView; isWide: boolean }

type SyncedBodyProps = LyricsBodyProps

const SyncedBody = ({ lyrics, isWide }: SyncedBodyProps) =>
  lyrics.kind === LYRICS_KINDS.synced && <SyncedLines isWide={isWide} lyrics={lyrics} />

type PlainBodyProps = LyricsBodyProps

/** Untimed words, scrolled in their own column on a wide screen. */
const PlainBody = ({ lyrics, isWide }: PlainBodyProps) => {
  const styles = useStyles()
  return (
    lyrics.kind === LYRICS_KINDS.plain && (
      <ScrollView nestedScrollEnabled style={isWide && styles.wideBox}>
        <Text variant={TEXT_VARIANTS.display} style={[styles.plain, isWide && styles.wideLyric]}>
          {lyrics.text}
        </Text>
      </ScrollView>
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
const LyricsBody = ({ lyrics, isWide }: LyricsBodyProps) => {
  const Body = LYRICS_BODIES[lyrics.kind]
  return <Body isWide={isWide} lyrics={lyrics} />
}

type NowPlayingAsideProps = {
  aside: Aside
  /** Whether it stands in its own column beside the player, filling the column's height. */
  isWide: boolean
}

type BookAsideProps = NowPlayingAsideProps

/** A book's controls, scrolled in their own column on a wide screen. */
const BookAside = ({ aside, isWide }: BookAsideProps) => {
  const own = useStyles()
  return (
    aside.kind === NOW_PLAYING_ASIDES.book && (
      <ScrollView nestedScrollEnabled style={isWide && own.wideBox}>
        <Book book={aside.book} />
      </ScrollView>
    )
  )
}

type LyricsAsideProps = NowPlayingAsideProps

const LyricsAside = ({ aside, isWide }: LyricsAsideProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  return (
    aside.kind === NOW_PLAYING_ASIDES.lyrics && (
      <View style={[styles.section, isWide && own.wideBox]}>
        <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.heading}>
          {MUSIC_COPY.lyrics}
        </Text>
        <LyricsBody isWide={isWide} lyrics={aside.lyrics} />
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

/**
 * A book's controls, or the lyrics under a heading: below Now Playing's controls on a phone,
 * in their own column beside the player on a wide screen.
 */
export const NowPlayingAside = ({ aside, isWide }: NowPlayingAsideProps) => {
  const AsideView = ASIDES[aside.kind]
  return <AsideView aside={aside} isWide={isWide} />
}
