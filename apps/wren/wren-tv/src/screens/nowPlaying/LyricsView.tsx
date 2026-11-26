import { type LyricLine, activeLineAt } from '@raven/core'
import { useAudioQueue, KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import {
  LYRIC_TONES,
  type LyricTone,
  NOW_PLAYING_COPY,
  SHOWN_LYRICS_KINDS,
  type ShownLyrics,
  lyricOffsetOf,
  lyricToneOf,
} from '@raven/wren'
import { useEffect, useRef, useState } from 'react'
import { ScrollView, type ScrollViewInstance, Text, View } from 'react-native'

import { OPACITIES, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { Focusable } from '@/ui/Focusable'

const useStyles = themedStyles(({ colors }) => ({
  scroller: { flex: 1 },
  lines: { gap: SPACE.s3, paddingBottom: SPACE.s8 },
  line: { alignSelf: 'flex-start', paddingHorizontal: SPACE.s1 },
  [LYRIC_TONES.sung]: { ...TYPE.lyric, color: colors.text3, opacity: OPACITIES.sung },
  [LYRIC_TONES.current]: { ...TYPE.lyric, color: colors.text },
  [LYRIC_TONES.upcoming]: { ...TYPE.lyric, color: colors.text2 },
  lit: { color: colors.accentText },
  plain: { ...TYPE.lyric, color: colors.text2 },
  empty: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  emptyText: { ...TYPE.body, color: colors.text2, textAlign: 'center' },
}))

type LyricRowProps = {
  line: LyricLine
  tone: LyricTone
  onSeek: (at: number) => void
  onPlace: (top: number) => void
}

/** A synced line, toned by whether it is sung, being sung or to come; a press plays from it. */
function LyricRow({ line, tone, onSeek, onPlace }: LyricRowProps) {
  const styles = useStyles()
  const words = line.text === '' ? NOW_PLAYING_COPY.instrumental : line.text
  return (
    <View onLayout={({ nativeEvent }) => onPlace(nativeEvent.layout.y)}>
      <Focusable
        hasRing={false}
        isSelected={tone === LYRIC_TONES.current}
        label={words}
        onPress={() => onSeek(line.at)}
        style={styles.line}
      >
        {({ isFocused }) => <Text style={[styles[tone], isFocused && styles.lit]}>{words}</Text>}
      </Focusable>
    </View>
  )
}

type SyncedLinesProps = { lines: readonly LyricLine[] }

/**
 * The synced lines, scrolled so the one being sung stays about a third of the way down. The
 * remote may walk the lines on its own; a press plays from the line it is on.
 */
function SyncedLines({ lines }: SyncedLinesProps) {
  const styles = useStyles()
  const position = useAudioQueue((store) => store.position)
  const seekTo = useAudioQueue((store) => store.seekTo)
  const scroller = useRef<ScrollViewInstance>(null)
  const tops = useRef<Record<number, number>>({})
  const [viewport, setViewport] = useState(0)
  const current = activeLineAt({ lines, at: position })
  // A song repeats lines, so each is keyed by its place and its time.
  const items = lines.map((line, place) => ({ key: `${place}:${line.at}`, place, line }))

  useEffect(() => {
    const lineTop = current === null ? 0 : (tops.current[current] ?? null)
    if (lineTop === null || scroller.current === null) return
    scroller.current.scrollTo({ y: lyricOffsetOf({ lineTop, viewport }), animated: true })
  }, [current, viewport])

  return (
    <ScrollView
      contentContainerStyle={styles.lines}
      onLayout={({ nativeEvent }) => setViewport(nativeEvent.layout.height)}
      ref={scroller}
      showsVerticalScrollIndicator={false}
      style={styles.scroller}
    >
      {items.map(({ key, place, line }) => (
        <LyricRow
          key={key}
          line={line}
          onPlace={(top) => {
            tops.current = { ...tops.current, [place]: top }
          }}
          onSeek={seekTo}
          tone={lyricToneOf({ place, current })}
        />
      ))}
    </ScrollView>
  )
}

type LyricsKind = ShownLyrics['kind']

type LyricsOfProps<K extends LyricsKind> = { lyrics: ShownLyrics & { kind: K } }

function SyncedLyrics({ lyrics }: LyricsOfProps<typeof SHOWN_LYRICS_KINDS.synced>) {
  return <SyncedLines lines={lyrics.lines} />
}

/** The words as they are, with no times to follow. */
function PlainLyrics({ lyrics }: LyricsOfProps<typeof SHOWN_LYRICS_KINDS.plain>) {
  const styles = useStyles()
  return (
    <ScrollView contentContainerStyle={styles.lines} style={styles.scroller}>
      <Text style={styles.plain}>{lyrics.text}</Text>
    </ScrollView>
  )
}

function NoLyrics() {
  const styles = useStyles()
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{NOW_PLAYING_COPY.noLyrics}</Text>
    </View>
  )
}

/** While the lyrics are read, the pane stays quiet. */
function ReadingLyrics() {
  const styles = useStyles()
  return <View style={styles.scroller} />
}

/** Each kind of lyrics' view props, or only `Keys`' for a builder generic over the kind. */
type LyricsProps<Keys extends LyricsKind = LyricsKind> = { [K in Keys]: LyricsOfProps<K> }

const LYRICS_VIEWS = {
  [SHOWN_LYRICS_KINDS.synced]: SyncedLyrics,
  [SHOWN_LYRICS_KINDS.plain]: PlainLyrics,
  [SHOWN_LYRICS_KINDS.none]: NoLyrics,
  [SHOWN_LYRICS_KINDS.reading]: ReadingLyrics,
} as const satisfies ViewsOf<LyricsProps>

/** The lyrics as their kind's view, so each view is handed its own kind of lyrics. */
const lyricsViewOf = <K extends LyricsKind>({
  lyrics,
}: LyricsOfProps<K>): ViewOf<LyricsProps<K>, K> => ({
  key: lyrics.kind,
  props: { lyrics },
})

type LyricsViewProps = { lyrics: ShownLyrics }

/** The song's words: synced lines a press plays from, plain words, that it has none, or nothing yet while they are read. */
export function LyricsView({ lyrics }: LyricsViewProps) {
  return <KeyedView<LyricsProps> view={lyricsViewOf({ lyrics })} views={LYRICS_VIEWS} />
}
