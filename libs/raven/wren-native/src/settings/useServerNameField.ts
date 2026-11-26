import { RENAME_OUTCOMES, type RenameOutcome } from '@raven/native/headless'
import { NAME_SAVES, SETTINGS_COPY, serverNameSaveOf } from '@raven/wren'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { accountServers } from '@/stores/activeServer'
import type { WrenSession } from '@/useWren'

/** What a rename that did not take says under the field, by why; null once it did. */
const RENAME_COPY = {
  [RENAME_OUTCOMES.renamed]: null,
  [RENAME_OUTCOMES.badName]: SETTINGS_COPY.serverNameError,
  [RENAME_OUTCOMES.noAccount]: SETTINGS_COPY.serverNameNoAccount,
} as const satisfies Record<RenameOutcome, string | null>

type UseServerNameFieldProps = { session: WrenSession }

/**
 * Settings' field for the server's name: what it shows, what went wrong, and whether a rename is
 * on its way. The name is the account's, saved as the field is sent, so raven and every Wren
 * signed in to it wear it; blank keeps it.
 */
export const useServerNameField = ({ session }: UseServerNameFieldProps) => {
  const { id, name } = session.server
  // What is being typed, null while nothing is, when the field shows the account's name.
  const [draft, setDraft] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const rename = useMutation({
    mutationFn: (typed: string) => accountServers.rename({ id, name: typed }),
    onSuccess: (outcome) => {
      setRefusal(RENAME_COPY[outcome])
      if (outcome === RENAME_OUTCOMES.renamed) setDraft(null)
    },
  })
  const saving = serverNameSaveOf({ text: draft ?? name, current: name })
  const problem = saving.kind === NAME_SAVES.refused ? SETTINGS_COPY.serverNameError : refusal
  return {
    value: draft ?? name,
    error: rename.isError ? SETTINGS_COPY.serverNameFailed : problem,
    isSaving: rename.isPending,
    onChangeText: (text: string) => {
      setDraft(text)
      setRefusal(null)
    },
    onSubmit: () => {
      if (saving.kind === NAME_SAVES.saved) rename.mutate(saving.name)
      if (saving.kind === NAME_SAVES.kept) setDraft(null)
    },
  }
}
