import { Text, View } from 'react-native'

import { SETTINGS_COPY } from '@raven/wren'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { GroupedList } from '@/ui/GroupedList'
import { IconTile, TILE_TONES } from '@/ui/IconTile'
import { ServerStatusChip } from '@/ui/ServerStatusChip'
import { ICONS } from '@/ui/WrenIcon'
import type { WrenSession } from '@/useWren'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACE.s3,
    minHeight: SIZE.navRow,
    paddingVertical: SPACE.s3,
  },
  text: { flex: 1 },
  name: { ...TYPE.rowTitle, color: colors.text },
  origin: { ...TYPE.meta, color: colors.text2 },
}))

type ServerGroupProps = { session: WrenSession }

/** The server Wren plays from: its name, its address, and whether it answers. */
export function ServerGroup({ session }: ServerGroupProps) {
  const styles = useStyles()
  // TODO(redesign): the design's chevron edits the server; Wren pins raven's and has no edit flow yet.
  return (
    <GroupedList heading={SETTINGS_COPY.server}>
      <View style={styles.row}>
        <IconTile icon={ICONS.server} tone={TILE_TONES.accent} />
        <View style={styles.text}>
          <Text numberOfLines={1} style={styles.name}>
            {session.server.name}
          </Text>
          <Text numberOfLines={1} style={styles.origin}>
            {session.server.origin}
          </Text>
        </View>
        <ServerStatusChip session={session} />
      </View>
    </GroupedList>
  )
}
