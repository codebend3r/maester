import { SETTINGS_COPY, STATUS_COPY, serverNameEditOf } from '@raven/wren'
import { useState } from 'react'
import { serverAddress } from '@/lib/serverAddress'
import { NotedGroup } from '@/screens/Settings/NotedGroup'
import { useServerName, useWrenPrefs } from '@/stores/wrenPrefs'
import { FactRow } from '@/ui/FactRow/FactRow'
import { IconTile, TILE_TONES } from '@/ui/IconTile/IconTile'
import { ServerStatusChip } from '@/ui/ServerStatusChip/ServerStatusChip'
import { TextField } from '@/ui/TextField/TextField'
import { ICONS } from '@/ui/WrenIcon/icons'
import styles from '@/screens/Settings/ServerGroup.module.scss'

/**
 * The server Wren plays from: its name, which the listener can change, whether it answers, and
 * its address with its port, which cannot be changed here.
 */
export function ServerGroup() {
  const name = useServerName()
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
    <NotedGroup heading={SETTINGS_COPY.server} note={SETTINGS_COPY.serverNote}>
      <div className={styles.row}>
        <IconTile icon={ICONS.server} tone={TILE_TONES.accent} />
        <p className={styles.name}>{name}</p>
        <ServerStatusChip />
      </div>
      <div className={styles.edit}>
        <TextField
          autoComplete="off"
          error={isRefused ? SETTINGS_COPY.serverNameError : null}
          label={SETTINGS_COPY.serverName}
          onChangeText={rename}
          placeholder={STATUS_COPY.raven}
          value={draft}
        />
      </div>
      <FactRow label={SETTINGS_COPY.serverAddress} value={serverAddress()} />
    </NotedGroup>
  )
}
