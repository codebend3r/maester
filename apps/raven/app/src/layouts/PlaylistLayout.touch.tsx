import { View } from 'react-native'

import { BUTTON_TONES } from '@/layouts/formKit'
import { touchForm } from '@/layouts/Form.touch'
import { MUSIC_COPY } from '@/layouts/copy'
import { type NewPlaylistButtonProps, type PlaylistLayoutProps } from '@/layouts/musicKit'
import { ListEntry, TouchPage, useMusicStyles } from '@/layouts/MusicParts.touch'
import { touchPicker } from '@/layouts/Picker.touch'
import { askPlaylistName, confirmDeletePlaylist } from '@/layouts/playlistSheets'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'

const { FormButton } = touchForm
const { ToolButton } = touchPicker

/**
 * A playlist under the thumb: its name and facts, Play, Shuffle, Rename and Delete, then its
 * tracks, each pressed to play from it, moved up or taken out where it is.
 */
export const PlaylistLayout = ({
  name,
  facts,
  tracks,
  playingId,
  note,
  onPlay,
  onShuffle,
  onPlayFrom,
  onRename,
  onDelete,
  onMoveUp,
  onRemove,
  onBack,
}: PlaylistLayoutProps) => {
  const styles = useMusicStyles()
  const isEmpty = tracks.length === 0
  return (
    <TouchPage onBack={onBack}>
      <View style={styles.stage}>
        <Text style={styles.muted}>{MUSIC_COPY.playlist}</Text>
        <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.title}>
          {name}
        </Text>
        <Text style={styles.muted}>{facts}</Text>
        <View style={styles.controls}>
          <FormButton
            isDisabled={isEmpty}
            label={MUSIC_COPY.play}
            onPress={onPlay}
            tone={BUTTON_TONES.primary}
          />
          <FormButton
            isDisabled={isEmpty}
            label={MUSIC_COPY.shuffle}
            onPress={onShuffle}
            tone={BUTTON_TONES.quiet}
          />
        </View>
        <View style={styles.controls}>
          <ToolButton
            accessibilityLabel={MUSIC_COPY.renamePlaylist}
            icon="edit"
            label={MUSIC_COPY.rename}
            onPress={() =>
              askPlaylistName({
                title: MUSIC_COPY.renamePlaylist,
                initial: name,
                submit: MUSIC_COPY.rename,
                onName: onRename,
              })
            }
          />
          <ToolButton
            accessibilityLabel={MUSIC_COPY.delete}
            icon="trash"
            label={MUSIC_COPY.delete}
            onPress={() => confirmDeletePlaylist({ name, onDelete })}
          />
        </View>
        {note !== null && <Text style={styles.error}>{note}</Text>}
      </View>
      {isEmpty && <Text style={styles.muted}>{MUSIC_COPY.emptyPlaylist(name)}</Text>}
      <View style={styles.list}>
        {tracks.map((track) => (
          <ListEntry
            key={track.key}
            isSelected={playingId === track.id}
            label={track.label}
            line={MUSIC_COPY.facts([track.line, track.length])}
            onPress={() => onPlayFrom(track.index)}
            title={track.title}
          >
            {track.index > 0 && (
              <ToolButton
                accessibilityLabel={MUSIC_COPY.moveUp(track.title)}
                icon="up"
                label={MUSIC_COPY.up}
                onPress={() => onMoveUp(track.index)}
              />
            )}
            <ToolButton
              accessibilityLabel={MUSIC_COPY.removeFrom(track.title)}
              icon="close"
              label={MUSIC_COPY.remove}
              onPress={() => onRemove(track.index)}
            />
          </ListEntry>
        ))}
      </View>
    </TouchPage>
  )
}

/** New playlist in a toolbar: asks for its name, then makes it. */
export const NewPlaylistButton = ({ onCreate }: NewPlaylistButtonProps) => (
  <ToolButton
    accessibilityLabel={MUSIC_COPY.newPlaylist}
    icon="plus"
    label={MUSIC_COPY.newPlaylist}
    onPress={() =>
      askPlaylistName({
        title: MUSIC_COPY.newPlaylist,
        initial: '',
        submit: MUSIC_COPY.create,
        onName: onCreate,
      })
    }
  />
)
