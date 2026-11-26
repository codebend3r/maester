import { type PlaylistDetails, isPlaylistName } from '@raven/core'
import { useServerPlaylistMutations } from '@raven/ui/headless'
import { NEW_PLAYLIST_COPY } from '@raven/wren'
import { useState } from 'react'
import { View } from 'react-native'

import { SPACE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { BUTTON_TONES, FocusButton } from '@/ui/FocusButton'
import { TextField } from '@/ui/TextField'
import { type WrenSession } from '@raven/wren-native'

const useStyles = themedStyles(() => ({ form: { gap: SPACE.s3 } }))

type NewPlaylistFormProps = {
  session: Pick<WrenSession, 'api'>
  /** The playlist the server made, once it has. */
  onCreated: (playlist: PlaylistDetails['playlist']) => void
}

/**
 * A new playlist's name, typed on the TV's keyboard, and Create, the one way every Wren names a
 * playlist. Create waits for a name core's `isPlaylistName` takes, and why the server refused one
 * is said under the field.
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
    <View style={styles.form}>
      <TextField
        error={create.error?.message ?? null}
        hasPreferredFocus
        label={NEW_PLAYLIST_COPY.name}
        onChangeText={setName}
        onSubmitEditing={make}
        placeholder={NEW_PLAYLIST_COPY.placeholder}
        returnKeyType="done"
        value={name}
      />
      <FocusButton
        isDisabled={!isNamed || create.isPending}
        label={NEW_PLAYLIST_COPY.create}
        onPress={make}
        text={NEW_PLAYLIST_COPY.create}
        tone={BUTTON_TONES.primary}
      />
    </View>
  )
}
