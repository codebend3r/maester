import { useAudioQueue } from '@raven/ui/headless'
import {
  NOW_PLAYING_COPY,
  PLAYER_COPY,
  countsLineOf,
  placesToClearOf,
  upNextRowsOf,
} from '@raven/wren'
import { FlatList, Text, View } from 'react-native'
import { useCovers, type WrenSession } from '@raven/wren-native'

import { RepeatToggle, ShuffleToggle } from '@/player/Transport'
import { QueueRow } from '@/screens/nowPlaying/QueueRow'
import { SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { FocusButton } from '@/ui/FocusButton'
import { ListFrame } from '@/ui/ListFrame'

const useStyles = themedStyles(({ colors }) => ({
  upNext: { flex: 1, gap: SPACE.s3 },
  head: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s3 },
  headText: { flex: 1, gap: SPACE.s1 / 2 },
  title: { ...TYPE.section, color: colors.text },
  line: { ...TYPE.meta, color: colors.text3 },
  // What changes the queue: Shuffle, Repeat and Clear.
  modes: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s2 },
  rows: { gap: SPACE.s1 },
  empty: { ...TYPE.body, color: colors.text2, paddingVertical: SPACE.s4 },
}))

type UpNextProps = {
  session: WrenSession
  /** The source's name for the line under the heading, or null when it has none. */
  sourceName: string | null
}

/**
 * What plays after this song: a heading with where the queue came from and how many songs are
 * left, beside what changes the queue, Shuffle, Repeat and Clear (which lets go of every song
 * still to play); then the songs, each playable, moved or taken off through its More.
 */
export function UpNext({ session, sourceName }: UpNextProps) {
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
  const songs = countsLineOf({ songs: rows.length })
  return (
    <View style={styles.upNext}>
      <View style={styles.head}>
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
        <View style={styles.modes}>
          <ShuffleToggle />
          <RepeatToggle />
          {rows.length > 0 && (
            <FocusButton
              label={NOW_PLAYING_COPY.clearLabel}
              onPress={() => placesToClearOf(rows).forEach((at) => remove(at))}
              text={NOW_PLAYING_COPY.clear}
            />
          )}
        </View>
      </View>
      <ListFrame>
        {(fill) => (
          <FlatList
            contentContainerStyle={styles.rows}
            data={rows}
            keyExtractor={(row) => row.key}
            ListEmptyComponent={<Text style={styles.empty}>{NOW_PLAYING_COPY.nothingNext}</Text>}
            renderItem={({ item }) => (
              <QueueRow
                first={first}
                last={last}
                onJump={jump}
                onMove={move}
                onRemove={remove}
                row={item}
                trackCoverOf={trackCoverOf}
              />
            )}
            style={fill}
          />
        )}
      </ListFrame>
    </View>
  )
}
