import type { ComponentType, ReactElement } from 'react'
import { ScrollView, type StyleProp, View, type ViewStyle } from 'react-native'

import { TrackColumns } from '@/screens/detail/TrackColumns'
import { usePageInsets } from '@/shell/useShell'
import { type WrenTheme, themedStyles, useFormFactor } from '@/theme/wrenTheme'
import { DETAIL_SIZES, SPACE, FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  split: { flex: 1, flexDirection: 'row', gap: SPACE.s10 },
  list: { flex: 1 },
  // Held at its width, so a head taller than the screen never squeezes the tracklist.
  headColumn: { flexGrow: 0, flexShrink: 0, width: DETAIL_SIZES.tabletColumn },
}))

/** What the layout hands the page's list of tracks: what heads it, its padding and its style. */
type DetailListFrame = {
  ListHeaderComponent: ReactElement
  contentContainerStyle: StyleProp<ViewStyle>
  style: StyleProp<ViewStyle>
}

type DetailSplitProps = {
  /** The album's or the playlist's head. */
  head: ReactElement
  /** Its tracks, a `SectionList` or a `FlatList`, laid out by the frame. */
  renderList: (frame: DetailListFrame) => ReactElement
}

/** A phone's album or playlist: one list, the head scrolling away above the tracks. */
function PhoneSplit({ head, renderList }: DetailSplitProps) {
  const styles = useStyles()
  const insets = usePageInsets()
  return renderList({
    ListHeaderComponent: head,
    contentContainerStyle: insets,
    style: styles.ground,
  })
}

/** A tablet's: the head in a column of its own, the tracklist beside it under its headings. */
function TabletSplit({ head, renderList }: DetailSplitProps) {
  const styles = useStyles()
  const { paddingBottom, ...sides } = usePageInsets()
  return (
    <View style={[styles.ground, styles.split, sides]}>
      <ScrollView contentContainerStyle={{ paddingBottom }} style={styles.headColumn}>
        {head}
      </ScrollView>
      {renderList({
        ListHeaderComponent: <TrackColumns />,
        contentContainerStyle: { paddingBottom },
        style: styles.list,
      })}
    </View>
  )
}

const DETAIL_SPLITS = {
  [FORM_FACTORS.phone]: PhoneSplit,
  [FORM_FACTORS.tablet]: TabletSplit,
} as const satisfies Record<FormFactor, ComponentType<DetailSplitProps>>

/** An album's or a playlist's page: its head and its tracks, laid out for the form factor. */
export function DetailSplit(props: DetailSplitProps) {
  const Split = DETAIL_SPLITS[useFormFactor()]
  return <Split {...props} />
}
