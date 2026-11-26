import { SETTINGS_COPY } from '@raven/wren'
import { type WrenSession, useServerNameField } from '@raven/wren-native'
import { Text, View } from 'react-native'

import { NotedGroup } from '@/screens/settings/NotedGroup'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { FactRow } from '@/ui/FactRow'
import { GroupedList } from '@/ui/GroupedList'
import { IconTile, TILE_TONES } from '@/ui/IconTile'
import { ServerStatusChip } from '@/ui/ServerStatusChip'
import { TextField } from '@/ui/TextField'
import { ICONS } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACE.s3,
    minHeight: SIZE.navRow,
    paddingVertical: SPACE.s3,
  },
  name: { ...TYPE.rowTitle, color: colors.text, flex: 1 },
  edit: { paddingVertical: SPACE.s3 },
}))

type ServerGroupProps = { session: WrenSession }

/**
 * The server Wren plays from: its name, which the listener can change, whether it answers, and
 * its address with its port, which cannot be changed here. The name is the account's, saved as
 * the field is left or sent, so raven and every Wren signed in to it wear it; blank keeps it.
 */
export function ServerGroup({ session }: ServerGroupProps) {
  const styles = useStyles()
  const { name } = session.server
  const field = useServerNameField({ session })
  return (
    <NotedGroup note={SETTINGS_COPY.serverNote}>
      <GroupedList heading={SETTINGS_COPY.server}>
        <View style={styles.row}>
          <IconTile icon={ICONS.server} tone={TILE_TONES.accent} />
          <Text numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          <ServerStatusChip session={session} />
        </View>
        <View style={styles.edit}>
          <TextField
            autoCapitalize="words"
            autoCorrect={false}
            editable={!field.isSaving}
            error={field.error}
            label={SETTINGS_COPY.serverName}
            onBlur={field.onSubmit}
            onChangeText={field.onChangeText}
            onSubmitEditing={field.onSubmit}
            returnKeyType="done"
            value={field.value}
          />
        </View>
        <FactRow label={SETTINGS_COPY.serverAddress} value={session.server.origin} />
      </GroupedList>
    </NotedGroup>
  )
}
