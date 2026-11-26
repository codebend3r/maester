import { RENAME_OUTCOMES, type RenameOutcome } from '@raven/native/headless'
import { NAME_SAVES, SETTINGS_COPY, STATUS_COPY, serverNameSaveOf } from '@raven/wren'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { FactRow, SettingsGroup } from '@/screens/settings/parts'
import { accountServers, type WrenSession, useMusicLibraries } from '@raven/wren-native'
import { TextField } from '@/ui/TextField'

/** What a rename that did not take says under the field, by why; null once it did. */
const RENAME_COPY = {
  [RENAME_OUTCOMES.renamed]: null,
  [RENAME_OUTCOMES.badName]: SETTINGS_COPY.serverNameError,
  [RENAME_OUTCOMES.noAccount]: SETTINGS_COPY.serverNameNoAccount,
} as const satisfies Record<RenameOutcome, string | null>

type ServerGroupProps = { session: WrenSession }

/**
 * The server Wren plays from: its name and whether it answers, its name to change, and its
 * address with its port, read only. The name is the account's, saved as the field is sent, so
 * raven and every Wren signed in to it wear it; blank keeps it.
 */
export function ServerGroup({ session }: ServerGroupProps) {
  const { name } = session.server
  const { failure } = useMusicLibraries(session)
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
  const status = failure === null ? STATUS_COPY.connected(name) : STATUS_COPY.unreachable(name)
  return (
    <SettingsGroup heading={SETTINGS_COPY.server} note={SETTINGS_COPY.serverNote}>
      <FactRow label={SETTINGS_COPY.server} value={status} />
      <TextField
        error={error}
        label={SETTINGS_COPY.serverName}
        onChangeText={typed}
        onSubmitEditing={save}
        returnKeyType="done"
        value={draft ?? name}
      />
      <FactRow label={SETTINGS_COPY.serverAddress} value={session.server.origin} />
    </SettingsGroup>
  )
}
