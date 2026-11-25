import { type LyricLine, activeLineAt } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import {
  LYRIC_TONES,
  lyricOffsetOf,
  type LyricTone,
  lyricToneOf,
  NOW_PLAYING_COPY,
  SHOWN_LYRICS_KINDS,
  type ShownLyrics,
} from '@raven/wren'
import { type ComponentType, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, type ScrollViewInstance, Text, View } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'

import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { OPACITIES, SPACE, TYPE } from '@/theme/wrenTokens'
import { pressedStyleOf } from '@/ui/press'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  scroller: { flex: 1 },
  lines: { gap: SPACE.s4 + SPACE.s1 / 2, paddingBottom: SPACE.s10 },
  [LYRIC_TONES.sung]: { ...TYPE.lyric, color: colors.text3, opacity: OPACITIES.sung },
  [LYRIC_TONES.current]: { ...TYPE.lyric, color: colors.text },
  [LYRIC_TONES.upcoming]: { ...TYPE.lyric, color: colors.text2 },
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: tone === LYRIC_TONES.current }}
      onLayout={({ nativeEvent }) => onPlace(nativeEvent.layout.y)}
      onPress={() => onSeek(line.at)}
      style={pressedStyleOf({ style: null })}
    >
      <Text style={styles[tone]}>
        {line.text === '' ? NOW_PLAYING_COPY.instrumental : line.text}
      </Text>
    </Pressable>
  )
}

type SyncedLinesProps = { lines: readonly LyricLine[] }

/*
 * The synced lines, scrolled so the one being sung stays about a third of the way down, unless
 * a finger holds the list; the scroll jumps rather than glides for a listener who asked for
 * less motion.
 */
function SyncedLines({ lines }: SyncedLinesProps) {
  const styles = useStyles()
  const position = useAudioQueue((store) => store.position)
  const seekTo = useAudioQueue((store) => store.seekTo)
  const isReduced = useReducedMotion()
  const scroller = useRef<ScrollViewInstance>(null)
  const tops = useRef<Record<number, number>>({})
  const isHeld = useRef(false)
  const [viewport, setViewport] = useState(0)
  const current = activeLineAt({ lines, at: position })
  // A song repeats lines, so each is keyed by its place and its time.
  const items = lines.map((line, place) => ({ key: `${place}:${line.at}`, place, line }))

  useEffect(() => {
    const lineTop = current === null ? 0 : (tops.current[current] ?? null)
    if (isHeld.current || lineTop === null || scroller.current === null) return
    scroller.current.scrollTo({ y: lyricOffsetOf({ lineTop, viewport }), animated: !isReduced })
  }, [current, viewport, isReduced])

  const letGo = () => {
    isHeld.current = false
  }
  return (
    <ScrollView
      contentContainerStyle={styles.lines}
      onLayout={({ nativeEvent }) => setViewport(nativeEvent.layout.height)}
      onMomentumScrollEnd={letGo}
      onScrollBeginDrag={() => {
        isHeld.current = true
      }}
      onScrollEndDrag={letGo}
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

type LyricsViews = { [K in LyricsKind]: ComponentType<LyricsOfProps<K>> }

const LYRICS_VIEWS = {
  [SHOWN_LYRICS_KINDS.synced]: SyncedLyrics,
  [SHOWN_LYRICS_KINDS.plain]: PlainLyrics,
  [SHOWN_LYRICS_KINDS.none]: NoLyrics,
  [SHOWN_LYRICS_KINDS.reading]: ReadingLyrics,
} as const satisfies LyricsViews

// Typed as the mapped type, so a kind looks up the view that takes that kind's lyrics.
const LYRICS: LyricsViews = LYRICS_VIEWS

/** The song's words: synced lines a press plays from, plain words, that it has none, or nothing yet while they are read. */
export function LyricsView<K extends LyricsKind>({ lyrics }: LyricsOfProps<K>) {
  const Shown: ComponentType<LyricsOfProps<K>> = LYRICS[lyrics.kind]
  return <Shown lyrics={lyrics} />
}
