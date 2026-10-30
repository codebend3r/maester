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
import { Text } from '@/layouts/Text'
import { useLineInView } from '@/layouts/useLineInView'
import { SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

const { FormButton } = touchForm
const { Picker } = touchPicker

/** How tall the synced lyrics' box stands, so the line sung keeps to the middle of it. */
const LYRICS_HEIGHT = SIZES.cover

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    lyricBox: { maxHeight: LYRICS_HEIGHT },
    lyricLines: { gap: SIZES.space2, paddingVertical: SIZES.space2 },
    lyric: { color: colours.muted, fontSize: SIZES.textLg },
    lyricOn: { color: colours.text, fontWeight: '600' },
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
          label={MUSIC_COPY.speed}
          onChoose={speedChooserOf(book.onSpeed)}
          options={SPEED_OPTIONS}
          value={String(book.speed)}
        />
      </View>
      <Text accessibilityRole="header" style={styles.heading}>
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

type SyncedLinesProps = { lyrics: SyncedLyrics }

/** Lines timed to the music in a box of their own, the one sung marked and kept in its middle. */
const SyncedLines = ({ lyrics }: SyncedLinesProps) => {
  const styles = useStyles()
  const { scroll, onBoxLayout, lineLayoutOf } = useLineInView({ current: lyrics.current })
  return (
    <ScrollView
      ref={scroll}
      accessibilityLabel={MUSIC_COPY.lyrics}
      contentContainerStyle={styles.lyricLines}
      nestedScrollEnabled
      onLayout={onBoxLayout}
      style={styles.lyricBox}
    >
      {lyrics.lines.map((line, place) => (
        <Text
          key={line.key}
          accessibilityState={{ selected: line.isCurrent }}
          onLayout={lineLayoutOf(place)}
          style={[styles.lyric, line.isCurrent && styles.lyricOn]}
        >
          {line.text}
        </Text>
      ))}
    </ScrollView>
  )
}

type LyricsBodyProps = { lyrics: LyricsView }

type SyncedBodyProps = LyricsBodyProps

const SyncedBody = ({ lyrics }: SyncedBodyProps) =>
  lyrics.kind === LYRICS_KINDS.synced && <SyncedLines lyrics={lyrics} />

type PlainBodyProps = LyricsBodyProps

const PlainBody = ({ lyrics }: PlainBodyProps) => {
  const styles = useMusicStyles()
  return lyrics.kind === LYRICS_KINDS.plain && <Text style={styles.rowTitle}>{lyrics.text}</Text>
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
const LyricsBody = ({ lyrics }: LyricsBodyProps) => {
  const Body = LYRICS_BODIES[lyrics.kind]
  return <Body lyrics={lyrics} />
}

type NowPlayingAsideProps = { aside: Aside }

type BookAsideProps = NowPlayingAsideProps

const BookAside = ({ aside }: BookAsideProps) =>
  aside.kind === NOW_PLAYING_ASIDES.book && <Book book={aside.book} />

type LyricsAsideProps = NowPlayingAsideProps

const LyricsAside = ({ aside }: LyricsAsideProps) => {
  const styles = useMusicStyles()
  return (
    aside.kind === NOW_PLAYING_ASIDES.lyrics && (
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>
          {MUSIC_COPY.lyrics}
        </Text>
        <LyricsBody lyrics={aside.lyrics} />
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

/** What sits below Now Playing's controls: a book's controls, or the lyrics under a heading. */
export const NowPlayingAside = ({ aside }: NowPlayingAsideProps) => {
  const AsideView = ASIDES[aside.kind]
  return <AsideView aside={aside} />
}
