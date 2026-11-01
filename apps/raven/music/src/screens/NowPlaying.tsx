import {
  LYRICS_KINDS,
  type LyricLine,
  type Lyrics,
  NO_LYRICS,
  REPEAT_MODES,
  type Track,
  artistNames,
  formatDuration,
} from '@raven/core'
import {
  AUDIOBOOK_SPEEDS,
  AUDIO_STATES,
  type QueueRow,
  activeLineAt,
  playTimeOf,
  playingTrackOf,
  queueRowsOf,
  useAudioQueue,
  useIsAudiobook,
  usePlayerPrefs,
} from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { type ComponentType, type ReactElement, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'

import { Adjuster } from '@/components/Adjuster'
import { AlbumArt } from '@/components/AlbumTile'
import { IconButton, ToggleButton } from '@/components/Controls'
import { Notice } from '@/components/Notice'
import { Segments } from '@/components/Segments'
import { pageStyles, useListContent } from '@/components/TabPage'
import { useCovers } from '@/music/useCovers'
import { NOW_PLAYING_COPY } from '@/screens/copy'
import { WREN_ICONS } from '@/theme/icons'
import { OPACITIES, PALETTE, SIZES } from '@/theme/wrenTheme'
import { type WrenSession, useWren } from '@/useWren'

/** The panes under the controls. */
const PANES = { lyrics: 'lyrics', queue: 'queue' } as const

type Pane = (typeof PANES)[keyof typeof PANES]

const PANE_SEGMENTS = [
  { key: PANES.lyrics, label: NOW_PLAYING_COPY.lyrics },
  { key: PANES.queue, label: NOW_PLAYING_COPY.queue },
] as const

/** The speeds a book plays at, each keyed by its number: "1.25×". */
const SPEED_SEGMENTS = AUDIOBOOK_SPEEDS.map((speed) => ({
  key: String(speed),
  label: NOW_PLAYING_COPY.speedOf(speed),
}))

/** How far a screen reader's swipe moves the scrubber, in seconds, and the volume. */
const STEPS = { seconds: 15, volume: 0.1 } as const

type ScrubTextOfProps = { at: number; length: number }

const scrubTextOf = ({ at, length }: ScrubTextOfProps): string =>
  NOW_PLAYING_COPY.scrubText({ at: formatDuration(at), length: formatDuration(length) })

/** Whether a track is queued for the sheet to show. */
const SHEET_STATES = { idle: 'idle', playing: 'playing' } as const

type SheetState = (typeof SHEET_STATES)[keyof typeof SHEET_STATES]

const sheetStateOf = (track: Track | null): SheetState =>
  track === null ? SHEET_STATES.idle : SHEET_STATES.playing

type HeadProps = {
  session: Pick<WrenSession, 'server' | 'api'>
  pane: Pane
  onPane: (pane: Pane) => void
}

type HeadViewProps = HeadProps & { track: Track | null; close: ReactElement }

type IdleHeadProps = HeadViewProps

/** The sheet with nothing queued: the way out, and that nothing plays. */
function IdleHead({ close }: IdleHeadProps) {
  return (
    <View style={pageStyles.header}>
      {close}
      <Notice text={NOW_PLAYING_COPY.nothing} />
    </View>
  )
}

type TrackHeadProps = HeadViewProps & { track: Track }

/** The sheet above its pane: the cover, the track, the scrubber, the controls and the volume. */
function TrackHead({ session, pane, onPane, track, close }: TrackHeadProps) {
  const coverOf = useCovers(session)
  const { width } = useWindowDimensions()
  const queue = useAudioQueue((store) => store.queue)
  const state = useAudioQueue((store) => store.state)
  const position = useAudioQueue((store) => store.position)
  const duration = useAudioQueue((store) => store.duration)
  const error = useAudioQueue((store) => store.error)
  const toggle = useAudioQueue((store) => store.toggle)
  const next = useAudioQueue((store) => store.next)
  const previous = useAudioQueue((store) => store.previous)
  const seekTo = useAudioQueue((store) => store.seekTo)
  const toggleShuffle = useAudioQueue((store) => store.toggleShuffle)
  const cycleRepeat = useAudioQueue((store) => store.cycleRepeat)
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const setVolume = usePlayerPrefs((prefs) => prefs.setVolume)
  const speed = usePlayerPrefs((prefs) => prefs.audiobookSpeed)
  const setSpeed = usePlayerPrefs((prefs) => prefs.setAudiobookSpeed)
  const isAudiobook = useIsAudiobook({ api: session.api, track })
  const length = duration ?? track.duration ?? 0
  const isPlaying = state === AUDIO_STATES.playing || state === AUDIO_STATES.loading
  return (
    <View style={pageStyles.header}>
      {close}
      <View style={styles.cover}>
        <AlbumArt
          cover={coverOf({ albumId: track.albumId, coverVersion: track.album.coverVersion })}
          size={Math.min(width - 2 * SIZES.space4, SIZES.measure / 2)}
          initial={track.album.title.slice(0, 1)}
        />
      </View>
      <View>
        <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={styles.line}>
          {artistNames(track)}
        </Text>
        {error !== null && (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Text>
        )}
      </View>
      <View>
        <Adjuster
          label={NOW_PLAYING_COPY.position}
          max={length}
          onChange={seekTo}
          step={STEPS.seconds}
          value={position}
          valueText={(at) => scrubTextOf({ at, length })}
        />
        <Text style={styles.line}>{playTimeOf({ position, duration: length })}</Text>
      </View>
      <View style={styles.controls}>
        <ToggleButton
          icon={WREN_ICONS.shuffle}
          isOn={queue.isShuffled}
          label={NOW_PLAYING_COPY.shuffle}
          onToggle={toggleShuffle}
        />
        <IconButton
          icon={WREN_ICONS.previous}
          label={NOW_PLAYING_COPY.previous}
          onPress={previous}
        />
        <IconButton
          icon={isPlaying ? WREN_ICONS.pause : WREN_ICONS.play}
          isProminent
          label={isPlaying ? NOW_PLAYING_COPY.pause : NOW_PLAYING_COPY.play}
          onPress={toggle}
        />
        <IconButton icon={WREN_ICONS.next} label={NOW_PLAYING_COPY.next} onPress={next} />
        <Pressable
          accessibilityRole="button"
          onPress={cycleRepeat}
          style={({ pressed }) => [styles.repeat, pressed && styles.pressed]}
        >
          <Text style={[styles.repeatLabel, queue.repeat !== REPEAT_MODES.off && styles.on]}>
            {NOW_PLAYING_COPY.repeat[queue.repeat]}
          </Text>
        </Pressable>
      </View>
      <Adjuster
        label={NOW_PLAYING_COPY.volume}
        max={1}
        onChange={(level) => setVolume({ volume: level, muted: false })}
        step={STEPS.volume}
        value={volume}
        valueText={NOW_PLAYING_COPY.percent}
      />
      {isAudiobook && (
        <View style={styles.speed}>
          <Text style={styles.line}>{NOW_PLAYING_COPY.speed}</Text>
          <Segments
            onSelect={(key) => {
              const picked = AUDIOBOOK_SPEEDS.find((each) => String(each) === key)
              if (picked !== undefined) setSpeed(picked)
            }}
            segments={SPEED_SEGMENTS}
            selected={String(speed)}
          />
        </View>
      )}
      <Segments onSelect={onPane} segments={PANE_SEGMENTS} selected={pane} />
    </View>
  )
}

type PlayingHeadProps = HeadViewProps

function PlayingHead({ track, ...props }: PlayingHeadProps) {
  return track !== null && <TrackHead {...props} track={track} />
}

/** What the sheet's head shows, with a track queued or none. */
const HEADS = {
  [SHEET_STATES.idle]: IdleHead,
  [SHEET_STATES.playing]: PlayingHead,
} as const satisfies Record<SheetState, ComponentType<HeadViewProps>>

/** The sheet's head: the way out, and the playing track with its controls, or that none plays. */
function Head(props: HeadProps) {
  const router = useRouter()
  const track = useAudioQueue(playingTrackOf)
  const close = (
    <IconButton
      icon={WREN_ICONS.close}
      label={NOW_PLAYING_COPY.close}
      onPress={() => router.back()}
    />
  )
  const HeadView = HEADS[sheetStateOf(track)]
  return <HeadView {...props} close={close} track={track} />
}

type LyricRowProps = { line: LyricLine; isCurrent: boolean; onSeek: (at: number) => void }

/** A line of synced lyrics, bright while it is sung; a press plays from it. */
function LyricRow({ line, isCurrent, onSeek }: LyricRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isCurrent }}
      onPress={() => onSeek(line.at)}
      style={({ pressed }) => [styles.lyric, pressed && styles.pressed]}
    >
      <Text style={[styles.lyricText, isCurrent && styles.sung]}>
        {line.text === '' ? NOW_PLAYING_COPY.instrumental : line.text}
      </Text>
    </Pressable>
  )
}

type LyricsNoteProps = { lyrics: Lyrics | null }

type NoteOfProps = { lyrics: Lyrics }

/** Synced lyrics are their lines, with nothing to note under them. */
function NoNote() {
  return null
}

type PlainNoteProps = NoteOfProps

/** The words as they are, with no times to follow. */
function PlainNote({ lyrics }: PlainNoteProps) {
  return lyrics.kind === LYRICS_KINDS.plain && <Text style={styles.plain}>{lyrics.text}</Text>
}

function NoLyricsNote() {
  return <Notice text={NOW_PLAYING_COPY.noLyrics} />
}

/** What the lyrics pane notes for each kind of lyrics. */
const LYRICS_NOTES = {
  [LYRICS_KINDS.synced]: NoNote,
  [LYRICS_KINDS.plain]: PlainNote,
  [LYRICS_KINDS.none]: NoLyricsNote,
} as const satisfies Record<Lyrics['kind'], ComponentType<NoteOfProps>>

type NoteProps = NoteOfProps

function Note({ lyrics }: NoteProps) {
  const NoteOf = LYRICS_NOTES[lyrics.kind]
  return <NoteOf lyrics={lyrics} />
}

/** What the lyrics pane says when it has no lines to time: the words as they are, or that there are none. */
function LyricsNote({ lyrics }: LyricsNoteProps) {
  return lyrics !== null && <Note lyrics={lyrics} />
}

type QueueEntryProps = {
  row: QueueRow
  onJump: (place: number) => void
  onMoveUp: (place: number) => void
  onRemove: (place: number) => void
}

/** A track in the queue: a press plays it, and it can move up or go. */
function QueueEntry({ row, onJump, onMoveUp, onRemove }: QueueEntryProps) {
  return (
    <View style={styles.entry}>
      <Pressable
        accessibilityLabel={NOW_PLAYING_COPY.entry({ title: row.title, line: row.line })}
        accessibilityRole="button"
        accessibilityState={{ selected: row.isCurrent }}
        onPress={() => onJump(row.place)}
        style={({ pressed }) => [styles.entryMain, pressed && styles.pressed]}
      >
        <Text numberOfLines={1} style={[styles.entryTitle, row.isCurrent && styles.on]}>
          {row.title}
        </Text>
        <Text numberOfLines={1} style={styles.line}>
          {row.line}
        </Text>
      </Pressable>
      {row.place > 0 && (
        <IconButton
          icon={WREN_ICONS.moveUp}
          label={NOW_PLAYING_COPY.moveUp(row.title)}
          onPress={() => onMoveUp(row.place)}
        />
      )}
      <IconButton
        icon={WREN_ICONS.remove}
        label={NOW_PLAYING_COPY.remove(row.title)}
        onPress={() => onRemove(row.place)}
      />
    </View>
  )
}

/** A line of synced lyrics, keyed by its place and time, since a song repeats lines. */
type LyricItem = { key: string; place: number; line: LyricLine }

type SheetViewProps = {
  head: ReactElement
  content: ReturnType<typeof useListContent>
  /** The lyrics to show, read or not yet. */
  lyrics: Lyrics | null
}

type IdleSheetProps = SheetViewProps

/** Nothing queued: the head alone. */
function IdleSheet({ head, content }: IdleSheetProps) {
  return <View style={[pageStyles.ground, ...content]}>{head}</View>
}

type QueueSheetProps = SheetViewProps

/** The queue under the head, each track playable, movable up and removable. */
function QueueSheet({ head, content }: QueueSheetProps) {
  const queue = useAudioQueue((store) => store.queue)
  const tracks = useAudioQueue((store) => store.tracks)
  const jump = useAudioQueue((store) => store.jump)
  const move = useAudioQueue((store) => store.move)
  const remove = useAudioQueue((store) => store.remove)
  return (
    <FlatList
      contentContainerStyle={content}
      data={queueRowsOf({ queue, tracks })}
      keyExtractor={(row) => row.key}
      ListHeaderComponent={head}
      renderItem={({ item }) => (
        <QueueEntry
          onJump={jump}
          onMoveUp={(place) => move({ from: place, to: place - 1 })}
          onRemove={remove}
          row={item}
        />
      )}
      style={pageStyles.ground}
    />
  )
}

type LyricsSheetProps = SheetViewProps

/** The lyrics under the head, a synced line bright while it is sung. */
function LyricsSheet({ head, content, lyrics }: LyricsSheetProps) {
  const position = useAudioQueue((store) => store.position)
  const seekTo = useAudioQueue((store) => store.seekTo)
  const lines: LyricItem[] =
    lyrics?.kind === LYRICS_KINDS.synced
      ? lyrics.lines.map((line, place) => ({ key: `${place}:${line.at}`, place, line }))
      : []
  const current =
    lyrics?.kind === LYRICS_KINDS.synced
      ? activeLineAt({ lines: lyrics.lines, at: position })
      : null
  return (
    <FlatList
      contentContainerStyle={content}
      data={lines}
      keyExtractor={(item) => item.key}
      ListFooterComponent={<LyricsNote lyrics={lyrics} />}
      ListHeaderComponent={head}
      renderItem={({ item }) => (
        <LyricRow isCurrent={item.place === current} line={item.line} onSeek={seekTo} />
      )}
      style={pageStyles.ground}
    />
  )
}

/** What the sheet draws: the head alone with nothing queued, else the pane picked under it. */
const SHEET_VIEWS = {
  [SHEET_STATES.idle]: IdleSheet,
  [PANES.lyrics]: LyricsSheet,
  [PANES.queue]: QueueSheet,
} as const satisfies Record<typeof SHEET_STATES.idle | Pane, ComponentType<SheetViewProps>>

type ShownLyricsOfProps = {
  isAudiobook: boolean
  lyrics: { data: Lyrics | undefined; isError: boolean }
}

/** The lyrics the pane shows: none for a book, and none, quietly, for a failed read. */
const shownLyricsOf = ({ isAudiobook, lyrics }: ShownLyricsOfProps): Lyrics | null => {
  if (isAudiobook) return NO_LYRICS
  if (lyrics.data !== undefined) return lyrics.data
  return lyrics.isError ? NO_LYRICS : null
}

type NowPlayingSheetProps = { session: WrenSession }

function NowPlayingSheet({ session }: NowPlayingSheetProps) {
  const [pane, setPane] = useState<Pane>(PANES.lyrics)
  const content = useListContent()
  const track = useAudioQueue(playingTrackOf)
  const isAudiobook = useIsAudiobook({ api: session.api, track })
  // A book has no words to look for.
  const lyrics = useQuery(
    session.queries.lyricsQuery(track === null || isAudiobook ? null : track.id),
  )
  const shown = shownLyricsOf({ isAudiobook, lyrics })
  const Sheet = SHEET_VIEWS[track === null ? SHEET_STATES.idle : pane]
  return (
    <Sheet
      content={content}
      head={<Head onPane={setPane} pane={pane} session={session} />}
      lyrics={shown}
    />
  )
}

/**
 * `/now-playing`, the sheet the bar opens: the cover large, the scrubber, the controls and the
 * volume, an audiobook's speed, and under them the lyrics (a synced line plays from where it is
 * sung) or the queue, each track playable, movable up and removable.
 */
export function NowPlaying() {
  const session = useWren()
  return session !== null && <NowPlayingSheet key={session.server.id} session={session} />
}

const styles = StyleSheet.create({
  cover: { alignItems: 'center' },
  title: { color: PALETTE.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  line: { color: PALETTE.muted, fontSize: SIZES.textSm },
  error: { color: PALETTE.error, fontSize: SIZES.textSm },
  controls: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  repeat: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: SIZES.fieldHeight,
  },
  repeatLabel: { color: PALETTE.muted, fontSize: SIZES.textSm, fontWeight: 'bold' },
  on: { color: PALETTE.accent },
  speed: { gap: SIZES.space1 },
  lyric: { paddingVertical: SIZES.space1 },
  lyricText: { color: PALETTE.muted, fontSize: SIZES.textLg, fontWeight: 'bold' },
  sung: { color: PALETTE.text },
  plain: { color: PALETTE.text, fontSize: SIZES.text },
  entry: {
    alignItems: 'center',
    borderBottomColor: PALETTE.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  entryMain: { flex: 1, justifyContent: 'center', minHeight: SIZES.fieldHeight },
  entryTitle: { color: PALETTE.text, fontSize: SIZES.text },
  pressed: { opacity: OPACITIES.pressed },
})
