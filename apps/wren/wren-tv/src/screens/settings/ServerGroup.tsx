import { SETTINGS_COPY, STATUS_COPY } from '@raven/wren'
import { type WrenSession, useMusicLibraries, useServerNameField } from '@raven/wren-native'

import { FactRow, SettingsGroup } from '@/screens/settings/parts'
import { TextField } from '@/ui/TextField'

type ServerGroupProps = { session: WrenSession }

/**
 * The server Wren plays from: its name and whether it answers, its name to change, and its
 * address with its port, read only. The name is the account's, saved as the field is sent, so
 * raven and every Wren signed in to it wear it; blank keeps it.
 */
export function ServerGroup({ session }: ServerGroupProps) {
  const { name } = session.server
  const { failure } = useMusicLibraries(session)
  const field = useServerNameField({ session })
  const status = failure === null ? STATUS_COPY.connected(name) : STATUS_COPY.unreachable(name)
  return (
    <SettingsGroup heading={SETTINGS_COPY.server} note={SETTINGS_COPY.serverNote}>
      <FactRow label={SETTINGS_COPY.server} value={status} />
      <TextField
        error={field.error}
        label={SETTINGS_COPY.serverName}
        onChangeText={field.onChangeText}
        onSubmitEditing={field.onSubmit}
        returnKeyType="done"
        value={field.value}
      />
      <FactRow label={SETTINGS_COPY.serverAddress} value={session.server.origin} />
    </SettingsGroup>
  )
}
