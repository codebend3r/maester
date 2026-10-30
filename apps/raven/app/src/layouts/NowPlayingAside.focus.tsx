import { LYRICS_KINDS } from '@raven/core'
import { ScrollView, StyleSheet, View } from 'react-native'

import { FocusBand } from '@/layouts/FocusBand'
import {
  type BookControls,
  MUSIC_COPY,
  NOW_PLAYING_ASIDES,
  type NowPlayingAside as Aside,
  SPEED_OPTIONS,
  speedChooserOf,
} from '@/layouts/musicKit'
import { ActionPlate, FocusRow, useMusicStyles } from '@/layouts/MusicParts.focus'
import type { LyricsView, SyncedLyrics } from '@/layouts/musicRows'
import { focusPicker } from '@/layouts/Picker.focus'
import { Text } from '@/layouts/Text'
import { useLineInView } from '@/layouts/useLineInView'
import { BUTTON_TONES } from '@/layouts/formKit'
import { TV_SIZES, tvSize } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

const { Picker } = focusPicker

/** How tall the synced lyrics' box stands, so the line sung keeps to the middle of it. */
const LYRICS_HEIGHT = tvSize(360)

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    lyricBox: { height: LYRICS_HEIGHT },
    lyricLines: { gap: TV_SIZES.space2, paddingVertical: TV_SIZES.space2 },
    lyric: { color: colours.muted, fontSize: TV_SIZES.textLg },
    lyricOn: { color: colours.text, fontWeight: 'bold' },
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
            icon="rewind"
            isPreferred={false}
            label={MUSIC_COPY.previousChapter}
            onPress={book.onPreviousChapter}
            text={MUSIC_COPY.previousChapter}
            tone={BUTTON_TONES.quiet}
          />
          {onNextChapter !== null && (
            <ActionPlate
              icon="forward"
              isPreferred={false}
              label={MUSIC_COPY.nextChapter}
              onPress={onNextChapter}
              text={MUSIC_COPY.nextChapter}
              tone={BUTTON_TONES.quiet}
            />
          )}
          <Picker
            label={MUSIC_COPY.speed}
            onChoose={speedChooserOf(book.onSpeed)}
            options={SPEED_OPTIONS}
            value={String(book.speed)}
          />
        </View>
      </FocusBand>
      <FocusBand>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>
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

type SyncedLinesProps = { lyrics: SyncedLyrics }

/**
 * Lines timed to the music in a box of their own, the one sung marked and kept in its middle.
 * Nothing in it takes the remote's focus; the box scrolls by itself.
 */
const SyncedLines = ({ lyrics }: SyncedLinesProps) => {
  const styles = useStyles()
  const { scroll, onBoxLayout, lineLayoutOf } = useLineInView({ current: lyrics.current })
  return (
    <ScrollView
      ref={scroll}
      accessibilityLabel={MUSIC_COPY.lyrics}
      contentContainerStyle={styles.lyricLines}
      onLayout={onBoxLayout}
      scrollEnabled={false}
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

/** The words themselves: timed lines, plain text, or a quiet word that there are none. */
const LyricsBody = ({ lyrics }: LyricsBodyProps) => {
  const styles = useMusicStyles()
  switch (lyrics.kind) {
    case LYRICS_KINDS.synced:
      return <SyncedLines lyrics={lyrics} />
    case LYRICS_KINDS.plain:
      return <Text style={styles.line}>{lyrics.text}</Text>
    case LYRICS_KINDS.none:
      return <Text style={styles.muted}>{MUSIC_COPY.noLyrics}</Text>
    default: {
      const unknown: never = lyrics
      return unknown
    }
  }
}

type NowPlayingAsideProps = { aside: Aside }

/** What sits below Now Playing's controls on a TV: a book's controls, or the lyrics under a heading. */
export const NowPlayingAside = ({ aside }: NowPlayingAsideProps) => {
  const styles = useMusicStyles()
  switch (aside.kind) {
    case NOW_PLAYING_ASIDES.book:
      return <Book book={aside.book} />
    case NOW_PLAYING_ASIDES.lyrics:
      return (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>
            {MUSIC_COPY.lyrics}
          </Text>
          <LyricsBody lyrics={aside.lyrics} />
        </View>
      )
    case NOW_PLAYING_ASIDES.none:
      return null
    default: {
      const unknown: never = aside
      return unknown
    }
  }
}
