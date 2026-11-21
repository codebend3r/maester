import { type PlaylistDetails, isPlaylistName } from '@raven/core'
import { useServerPlaylistMutations } from '@raven/ui/headless'
import { NEW_PLAYLIST_COPY } from '@raven/wren'
import { type FormEvent, useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/ui/Button/Button'
import { TextField } from '@/ui/TextField/TextField'
import { ICONS } from '@/ui/WrenIcon/icons'
import styles from '@/ui/NewPlaylistForm/NewPlaylistForm.module.scss'

type NewPlaylistFormProps = {
  /** The playlist the server made, once it has. */
  onCreated: (playlist: PlaylistDetails['playlist']) => void
}

/**
 * A new playlist's name and Create. Create waits for a name core's `isPlaylistName` takes, and
 * why the server refused one is said under the field.
 */
export function NewPlaylistForm({ onCreated }: NewPlaylistFormProps) {
  const { create } = useServerPlaylistMutations({ api })
  const [name, setName] = useState('')
  const typed = name.trim()
  const isNamed = isPlaylistName(typed)
  const make = (event: FormEvent) => {
    event.preventDefault()
    if (!isNamed) return
    create.mutate(typed, { onSuccess: ({ playlist }) => onCreated(playlist) })
  }
  return (
    <form className={styles.form} onSubmit={make}>
      <TextField
        autoComplete="off"
        enterKeyHint="done"
        error={create.error?.message ?? null}
        icon={ICONS.playlist}
        label={NEW_PLAYLIST_COPY.name}
        onChangeText={setName}
        placeholder={NEW_PLAYLIST_COPY.placeholder}
        value={name}
      />
      <Button
        isDisabled={!isNamed}
        isLoading={create.isPending}
        isSubmit
        label={NEW_PLAYLIST_COPY.create}
      />
    </form>
  )
}
