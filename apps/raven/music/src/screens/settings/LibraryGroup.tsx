import { SETTINGS_COPY } from '@raven/wren'
import { Pressable, Text, View } from 'react-native'

import { useMusicLibraries } from '@/music/musicLibraries'
import { NotedGroup } from '@/screens/settings/NotedGroup'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { GroupedList } from '@/ui/GroupedList'
import { pressedStyleOf } from '@/ui/press'
import { UNSEEN } from '@/ui/Unseen'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'
import type { WrenSession } from '@/useWren'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s3, minHeight: SIZE.navRow },
  name: { ...TYPE.rowTitle, color: colors.text, flex: 1 },
}))

type LibraryGroupProps = { session: WrenSession }

/**
 * The server's music libraries, one of them worn: Home, Search and the collection show the one
 * picked. It draws nothing until the server has named a music library.
 */
export function LibraryGroup({ session }: LibraryGroupProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const music = useMusicLibraries(session)
  const change = useWrenPrefs((state) => state.change)
  const [worn] = music.libraries
  return (
    worn !== undefined && (
      <NotedGroup note={SETTINGS_COPY.libraryNote}>
        <View accessibilityLabel={SETTINGS_COPY.library} accessibilityRole="radiogroup">
          <GroupedList heading={SETTINGS_COPY.library}>
            {music.all.map(({ id, name }) => (
              <Pressable
                accessibilityLabel={name}
                accessibilityRole="radio"
                accessibilityState={{ checked: id === worn.id }}
                key={id}
                onPress={() => change({ libraryId: id })}
                style={pressedStyleOf({ style: styles.row })}
              >
                <Text numberOfLines={1} style={styles.name}>
                  {name}
                </Text>
                {/* Drawn on every row, so no row changes when it is picked; seen on the worn one alone. */}
                <View style={id !== worn.id && UNSEEN}>
                  <WrenIcon color={colors.accentText} name={ICONS.check} size={SIZE.smallIcon} />
                </View>
              </Pressable>
            ))}
          </GroupedList>
        </View>
      </NotedGroup>
    )
  )
}
