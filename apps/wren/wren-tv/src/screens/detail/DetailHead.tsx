import type { QueueSource, Track } from '@raven/core'
import { DETAIL_COPY } from '@raven/wren'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'

import { type Cover } from '@raven/wren-native'
import { SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { AlbumArt } from '@/ui/AlbumArt'
import { PlayButtons } from '@/components/PlayButtons'
import { FocusButton } from '@/ui/FocusButton'
import { PageHeader } from '@/ui/Headers'
import { ICONS } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }) => ({
  head: { gap: SPACE.s3, width: SIZE.headArt },
  meta: { ...TYPE.meta, color: colors.text2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.s2 },
}))

type DetailHeadProps = {
  title: string
  cover: Cover | null
  /** A round picture, an artist's photo. */
  isRound?: boolean
  /** What sits under the title: an album's artists. */
  byline?: ReactNode
  /** The facts line: "1997 · 3 songs · 15 min". */
  meta: string
  /** Whether there is anything to play; without, Play and Shuffle are left out, as on the phone. */
  canPlay?: boolean
  /** The page's tracks, which Play and Shuffle read as they are pressed. */
  tracksOf: () => Promise<readonly Track[]>
  /** Where the queue says it plays from. */
  source: QueueSource
  /** The page's own actions after Shuffle: Like, Follow, Queue. */
  actions?: ReactNode
  onMore: () => void
}

/**
 * The head of an album's, a playlist's or an artist's page, a column at the TV's left: the
 * picture, the title, the facts, then Play, where the remote starts, Shuffle, the page's own
 * actions and More.
 */
export function DetailHead({
  title,
  cover,
  isRound = false,
  byline,
  meta,
  canPlay = true,
  tracksOf,
  source,
  actions,
  onMore,
}: DetailHeadProps) {
  const styles = useStyles()
  return (
    <View style={styles.head}>
      <AlbumArt cover={cover} isRound={isRound} size={SIZE.headArt} />
      <PageHeader title={title} />
      {byline}
      <Text style={styles.meta}>{meta}</Text>
      <View style={styles.actions}>
        {canPlay && <PlayButtons hasPreferredFocus source={source} tracksOf={tracksOf} />}
        {actions}
        <FocusButton
          hasPreferredFocus={!canPlay}
          icon={ICONS.more}
          label={DETAIL_COPY.more}
          onPress={onMore}
        />
      </View>
    </View>
  )
}
