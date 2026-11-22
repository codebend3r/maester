import { useState } from 'react'
import { Text, View } from 'react-native'

import { SETTINGS_COPY, serverNameEditOf } from '@raven/wren'
import { NotedGroup } from '@/screens/settings/NotedGroup'
import { useServerName, useWrenPrefs } from '@/stores/wrenPrefs'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { FactRow } from '@/ui/FactRow'
import { GroupedList } from '@/ui/GroupedList'
import { IconTile, TILE_TONES } from '@/ui/IconTile'
import { ServerStatusChip } from '@/ui/ServerStatusChip'
import { TextField } from '@/ui/TextField'
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
  name: { ...TYPE.rowTitle, color: colors.text, flex: 1 },
  edit: { paddingVertical: SPACE.s3 },
}))

type ServerGroupProps = { session: WrenSession }

/**
 * The server Wren plays from: its name, which the listener can change, whether it answers, and
 * its address with its port, which cannot be changed here.
 */
export function ServerGroup({ session }: ServerGroupProps) {
  const styles = useStyles()
  const name = useServerName({ fallback: session.server.name })
  const change = useWrenPrefs((state) => state.change)
  const picked = useWrenPrefs((state) => state.serverName)
  const [draft, setDraft] = useState(picked ?? '')
  const isRefused = serverNameEditOf(draft).isRefused

  const rename = (text: string) => {
    setDraft(text)
    const edit = serverNameEditOf(text)
    if (edit.isRefused) return
    change({ serverName: edit.serverName })
  }

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
            error={isRefused ? SETTINGS_COPY.serverNameError : null}
            label={SETTINGS_COPY.serverName}
            onChangeText={rename}
            placeholder={session.server.name}
            value={draft}
          />
        </View>
        <FactRow label={SETTINGS_COPY.serverAddress} value={session.server.origin} />
      </GroupedList>
    </NotedGroup>
  )
}
