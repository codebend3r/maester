import type { QueueSource, Track } from '@raven/core'
import { DETAIL_COPY, WREN_ICONS } from '@raven/wren'
import { type ComponentProps, type ReactNode, useState } from 'react'
import { Text, View } from 'react-native'

import { type Cover, type WrenSession } from '@raven/wren-native'
import { SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { AlbumArt } from '@/ui/AlbumArt'
import { PlayButtons } from '@/components/PlayButtons'
import { TracksMenu } from '@/components/TracksMenu'
import { FocusButton } from '@/ui/FocusButton'
import { PageHeader } from '@/ui/Headers'

const useStyles = themedStyles(({ colors }) => ({
  head: { gap: SPACE.s3, width: SIZE.headArt },
  meta: { ...TYPE.meta, color: colors.text2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.s2 },
}))

type TracksMenuProps = ComponentProps<typeof TracksMenu>

/** What the page's More menu holds beside the page's title and tracks. */
type DetailMenu = Pick<TracksMenuProps, 'canAddToPlaylist' | 'places'> & {
  /** The quiet line under the menu's title: an album's artists, else the page's facts. */
  line: TracksMenuProps['head']['line']
}

type DetailHeadProps = {
  session: WrenSession
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
  /** The page's tracks, which Play, Shuffle and the More menu read as they are pressed. */
  tracksOf: () => Promise<readonly Track[]>
  /** Where the queue says it plays from. */
  source: QueueSource
  /** The page's own actions after Shuffle: Like, Follow, Queue. */
  actions?: ReactNode
  menu: DetailMenu
}

/**
 * The head of an album's, a playlist's or an artist's page, a column at the TV's left: the
 * picture, the title, the facts, then Play, where the remote starts, Shuffle, the page's own
 * actions and More, which opens the page's menu over its tracks.
 */
export function DetailHead({
  session,
  title,
  cover,
  isRound = false,
  byline,
  meta,
  canPlay = true,
  tracksOf,
  source,
  actions,
  menu,
}: DetailHeadProps) {
  const styles = useStyles()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  return (
    <>
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
            icon={WREN_ICONS.more}
            label={DETAIL_COPY.more}
            onPress={() => setIsMenuOpen(true)}
          />
        </View>
      </View>
      {isMenuOpen && (
        <TracksMenu
          canAddToPlaylist={menu.canAddToPlaylist}
          head={{ title, line: menu.line }}
          onClose={() => setIsMenuOpen(false)}
          places={menu.places}
          session={session}
          tracksOf={tracksOf}
        />
      )}
    </>
  )
}
