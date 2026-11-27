import { type PlaylistDetails, isPlaylistName } from '@raven/core'
import { useServerPlaylistMutations } from '@raven/ui/headless'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform } from 'react-native'

import { NEW_PLAYLIST_COPY, WREN_ICONS } from '@raven/wren'
import { themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'
import { Button } from '@/ui/Button'
import { TextField } from '@/ui/TextField'
import { type WrenSession } from '@raven/wren-native'

const useStyles = themedStyles(() => ({ form: { gap: SPACE.s3 } }))

type NewPlaylistFormProps = {
  session: Pick<WrenSession, 'api'>
  /** The playlist the server made, once it has. */
  onCreated: (playlist: PlaylistDetails['playlist']) => void
}

/**
 * A new playlist's name and Create, kept clear of the keyboard. Create waits for a name core's
 * `isPlaylistName` takes, and why the server refused one is said under the field.
 */
export function NewPlaylistForm({ session, onCreated }: NewPlaylistFormProps) {
  const styles = useStyles()
  const { create } = useServerPlaylistMutations({ api: session.api })
  const [name, setName] = useState('')
  const typed = name.trim()
  const isNamed = isPlaylistName(typed)
  const make = () => {
    if (!isNamed) return
    create.mutate(typed, { onSuccess: ({ playlist }) => onCreated(playlist) })
  }
  return (
    <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding' })} style={styles.form}>
      <TextField
        error={create.error?.message ?? null}
        icon={WREN_ICONS.playlist}
        label={NEW_PLAYLIST_COPY.name}
        onChangeText={setName}
        onSubmitEditing={make}
        placeholder={NEW_PLAYLIST_COPY.placeholder}
        returnKeyType="done"
        value={name}
      />
      <Button
        isDisabled={!isNamed}
        isLoading={create.isPending}
        label={NEW_PLAYLIST_COPY.create}
        onPress={make}
      />
    </KeyboardAvoidingView>
  )
}
