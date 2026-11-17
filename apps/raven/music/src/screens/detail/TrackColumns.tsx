import { Text, View } from 'react-native'

import { DETAIL_COPY } from '@/screens/copy'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE } from '@/theme/wrenTokens'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  columns: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: SIZE.hairline,
    flexDirection: 'row',
    gap: SIZE.rowGap,
    paddingBottom: SPACE.s3,
    paddingHorizontal: SPACE.s3,
    paddingRight: SPACE.s3 + SIZE.smallButton,
  },
  heading: { ...TYPE.overline, color: colors.text3 },
  number: { textAlign: 'center', width: SIZE.trackNumber },
  title: { flex: 1 },
}))

/** The headings over a tablet's tracklist: #, Title and Time, lined up with the rows. */
export function TrackColumns() {
  const styles = useStyles()
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.columns}
    >
      <Text style={[styles.heading, styles.number]}>{DETAIL_COPY.columns.number}</Text>
      <Text style={[styles.heading, styles.title]}>{DETAIL_COPY.columns.title}</Text>
      <Text style={styles.heading}>{DETAIL_COPY.columns.time}</Text>
    </View>
  )
}
