import { RENAME_OUTCOMES, type RenameOutcome } from '@raven/native/headless'
import { SETTINGS_COPY, NAME_SAVES, serverNameSaveOf } from '@raven/wren'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Text, View } from 'react-native'

import { NotedGroup } from '@/screens/settings/NotedGroup'
import { accountServers } from '@/stores/activeServer'
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

/** What a rename that did not take says under the field, by why; null once it did. */
const RENAME_COPY = {
  [RENAME_OUTCOMES.renamed]: null,
  [RENAME_OUTCOMES.badName]: SETTINGS_COPY.serverNameError,
  [RENAME_OUTCOMES.noAccount]: SETTINGS_COPY.serverNameNoAccount,
} as const satisfies Record<RenameOutcome, string | null>

type ServerGroupProps = { session: WrenSession }

/**
 * The server Wren plays from: its name, which the listener can change, whether it answers, and
 * its address with its port, which cannot be changed here. The name is the account's, saved as
 * the field is left or sent, so raven and every Wren signed in to it wear it; blank keeps it.
 */
export function ServerGroup({ session }: ServerGroupProps) {
  const styles = useStyles()
  const { name } = session.server
  // What is being typed, null while nothing is, when the field shows the account's name.
  const [draft, setDraft] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const rename = useMutation({
    mutationFn: (typed: string) => accountServers.rename({ id: session.server.id, name: typed }),
    onSuccess: (outcome) => {
      setRefusal(RENAME_COPY[outcome])
      if (outcome === RENAME_OUTCOMES.renamed) setDraft(null)
    },
  })
  const saving = serverNameSaveOf({ text: draft ?? name, current: name })

  const save = () => {
    if (saving.kind === NAME_SAVES.saved) rename.mutate(saving.name)
    if (saving.kind === NAME_SAVES.kept) setDraft(null)
  }

  const typed = (text: string) => {
    setDraft(text)
    setRefusal(null)
  }

  const problem = saving.kind === NAME_SAVES.refused ? SETTINGS_COPY.serverNameError : refusal
  const error = rename.isError ? SETTINGS_COPY.serverNameFailed : problem

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
            editable={!rename.isPending}
            error={error}
            label={SETTINGS_COPY.serverName}
            onBlur={save}
            onChangeText={typed}
            onSubmitEditing={save}
            returnKeyType="done"
            value={draft ?? name}
          />
        </View>
        <FactRow label={SETTINGS_COPY.serverAddress} value={session.server.origin} />
      </GroupedList>
    </NotedGroup>
  )
}
