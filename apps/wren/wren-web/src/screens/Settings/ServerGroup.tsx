import { SETTINGS_COPY, STATUS_COPY, NAME_SAVES, serverNameSaveOf } from '@raven/wren'
import { queryKeys } from '@raven/ui/headless'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useAccountData } from '@/lib/accountData'
import { serverAddress } from '@/lib/serverAddress'
import { useServerName } from '@/lib/serverName'
import { NotedGroup } from '@/screens/Settings/NotedGroup'
import { FactRow } from '@/ui/FactRow/FactRow'
import { IconTile, TILE_TONES } from '@/ui/IconTile/IconTile'
import { ServerStatusChip } from '@/ui/ServerStatusChip/ServerStatusChip'
import { TextField } from '@/ui/TextField/TextField'
import { ICONS } from '@/ui/WrenIcon/icons'
import styles from '@/screens/Settings/ServerGroup.module.scss'

/**
 * The server Wren plays from: its name, which the listener can change, whether it answers, and
 * its address with its port, which cannot be changed here. The name is the account's, saved as
 * the field is left or sent, so raven and every Wren signed in to it wear it; blank keeps it.
 */
export function ServerGroup() {
  const name = useServerName()
  const { client, userId, serverId } = useAccountData()
  const queryClient = useQueryClient()
  // What is being typed, null while nothing is, when the field shows the account's name.
  const [draft, setDraft] = useState<string | null>(null)
  const [isWithoutAccount, setWithoutAccount] = useState(false)
  const rename = useMutation({
    mutationFn: async (typed: string) => {
      if (client === null || userId === null || serverId === null) return false
      await client.nameServer({ serverId, name: typed })
      await queryClient.invalidateQueries({ queryKey: queryKeys.serverNames(userId) })
      return true
    },
    onSuccess: (isSaved) => {
      setWithoutAccount(!isSaved)
      if (isSaved) setDraft(null)
    },
  })
  const saving = serverNameSaveOf({ text: draft ?? name, current: name })

  const save = () => {
    if (saving.kind === NAME_SAVES.saved) rename.mutate(saving.name)
    if (saving.kind === NAME_SAVES.kept) setDraft(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save()
  }

  const typed = (text: string) => {
    setDraft(text)
    setWithoutAccount(false)
  }

  const refusal = isWithoutAccount ? SETTINGS_COPY.serverNameNoAccount : null
  const problem = saving.kind === NAME_SAVES.refused ? SETTINGS_COPY.serverNameError : refusal
  const error = rename.isError ? SETTINGS_COPY.serverNameFailed : problem

  return (
    <NotedGroup heading={SETTINGS_COPY.server} note={SETTINGS_COPY.serverNote}>
      <div className={styles.row}>
        <IconTile icon={ICONS.server} tone={TILE_TONES.accent} />
        <p className={styles.name}>{name}</p>
        <ServerStatusChip />
      </div>
      <form className={styles.edit} onSubmit={submit}>
        <TextField
          autoComplete="off"
          disabled={rename.isPending}
          error={error}
          label={SETTINGS_COPY.serverName}
          onBlur={save}
          onChangeText={typed}
          placeholder={STATUS_COPY.raven}
          value={draft ?? name}
        />
      </form>
      <FactRow label={SETTINGS_COPY.serverAddress} value={serverAddress()} />
    </NotedGroup>
  )
}
