import { useAudioQueue } from '@raven/ui/headless'
import {
  countsLineOf,
  NOW_PLAYING_COPY,
  placesToClearOf,
  PLAYER_COPY,
  upNextRowsOf,
} from '@raven/wren'
import type { ComponentType } from 'react'
import { FlatList, Text, View } from 'react-native'

import { useCovers } from '@/music/useCovers'
import { QueueRow } from '@/screens/nowPlaying/QueueRow'
import { RepeatToggle, ShuffleToggle } from '@/player/Transport'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { PLAYER_SIZES, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { TextLink } from '@/ui/TextLink'
import type { WrenSession } from '@/useWren'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  upNext: { flex: 1 },
  head: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s3 },
  sheetHead: {
    paddingBottom: PLAYER_SIZES.upNextHeadBottom,
    paddingHorizontal: PLAYER_SIZES.gutter,
    paddingTop: PLAYER_SIZES.upNextHeadTop,
  },
  panelHead: { paddingBottom: SPACE.s2 },
  headText: { flex: 1 },
  title: { ...TYPE.paneTitle, color: colors.text },
  line: { ...TYPE.meta, color: colors.text3 },
  toggles: { flexDirection: 'row', gap: SPACE.s1 },
  list: { flex: 1 },
  empty: { ...TYPE.body, color: colors.text2, paddingVertical: SPACE.s4 },
  sheetEmpty: { paddingHorizontal: PLAYER_SIZES.gutter },
}))

/** Where Up next sits: under the phone's player, or along the foot of the tablet's. */
export const UP_NEXT_PLACES = { sheet: 'sheet', panel: 'panel' } as const

export type UpNextPlace = (typeof UP_NEXT_PLACES)[keyof typeof UP_NEXT_PLACES]

type HeadEndProps = { onClear: () => void; hasRows: boolean }

/** The phone's: Shuffle and Repeat, on circles. */
function SheetToggles() {
  const styles = useStyles()
  return (
    <View style={styles.toggles}>
      <ShuffleToggle isFilled size={PLAYER_SIZES.toggleCircle} />
      <RepeatToggle isFilled size={PLAYER_SIZES.toggleCircle} />
    </View>
  )
}

/** The tablet's: Clear, which lets go of every song still to play. */
function PanelClear({ onClear, hasRows }: HeadEndProps) {
  return (
    hasRows && (
      <TextLink
        label={NOW_PLAYING_COPY.clear}
        onPress={onClear}
        spoken={NOW_PLAYING_COPY.clearLabel}
      />
    )
  )
}

const HEAD_ENDS = {
  [UP_NEXT_PLACES.sheet]: SheetToggles,
  [UP_NEXT_PLACES.panel]: PanelClear,
} as const satisfies Record<UpNextPlace, ComponentType<HeadEndProps>>

/** How each place lays its list out: a row's height, and the styles its head and its empty line take. */
const PLACE_LOOKS = {
  [UP_NEXT_PLACES.sheet]: { height: SIZE.row, head: 'sheetHead', empty: 'sheetEmpty' },
  [UP_NEXT_PLACES.panel]: { height: SIZE.navRow, head: 'panelHead', empty: null },
} as const

type UpNextProps = {
  session: WrenSession
  /** The source's name for the line under the heading, or null when it has none. */
  sourceName: string | null
  place: UpNextPlace
}

/**
 * What plays after this song: a heading with where the queue came from and how many songs are
 * left, then the songs, each playable, draggable to another place and swiped away.
 */
export function UpNext({ session, sourceName, place }: UpNextProps) {
  const styles = useStyles()
  const { trackCoverOf } = useCovers(session)
  const queue = useAudioQueue((store) => store.queue)
  const tracks = useAudioQueue((store) => store.tracks)
  const jump = useAudioQueue((store) => store.jump)
  const move = useAudioQueue((store) => store.move)
  const remove = useAudioQueue((store) => store.remove)
  const rows = upNextRowsOf({ queue, tracks })
  const first = rows[0]?.place ?? 0
  const last = rows.at(-1)?.place ?? 0
  const { height, head, empty } = PLACE_LOOKS[place]
  const HeadEnd = HEAD_ENDS[place]
  const songs = countsLineOf({ songs: rows.length })
  return (
    <View style={styles.upNext}>
      <View style={[styles.head, styles[head]]}>
        <View style={styles.headText}>
          <Text accessibilityRole="header" style={styles.title}>
            {PLAYER_COPY.upNext}
          </Text>
          {rows.length > 0 && (
            <Text numberOfLines={1} style={styles.line}>
              {NOW_PLAYING_COPY.sourceLine({ source: sourceName, songs })}
            </Text>
          )}
        </View>
        <HeadEnd
          hasRows={rows.length > 0}
          onClear={() => placesToClearOf(rows).forEach((at) => remove(at))}
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        ListEmptyComponent={
          <Text style={[styles.empty, empty !== null && styles[empty]]}>
            {NOW_PLAYING_COPY.nothingNext}
          </Text>
        }
        renderItem={({ item }) => (
          <QueueRow
            first={first}
            height={height}
            last={last}
            onJump={jump}
            onMove={move}
            onRemove={remove}
            place={place}
            row={item}
            trackCoverOf={trackCoverOf}
          />
        )}
        style={styles.list}
      />
    </View>
  )
}
