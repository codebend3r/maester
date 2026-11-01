import type { AlbumTrack } from '@raven/ui/headless'
import { type AccessibilityActionEvent, Pressable, StyleSheet, View } from 'react-native'

import { BUTTON_TONES } from '@/layouts/formKit'
import { touchForm } from '@/layouts/Form.touch'
import { MUSIC_COPY } from '@/layouts/copy'
import { type AlbumLayoutProps, ROW_ACTIONS } from '@/layouts/musicKit'
import { Cover, FavouriteButton, TouchPage, useMusicStyles } from '@/layouts/MusicParts.touch'
import { touchPicker } from '@/layouts/Picker.touch'
import { openAddToPlaylistSheet } from '@/layouts/playlistSheets'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

const { FormButton } = touchForm
const { ToolButton } = touchPicker

/** What the screen reader offers on a track row besides playing it. */
const TRACK_ACTIONS = [{ name: ROW_ACTIONS.addToPlaylist, label: MUSIC_COPY.addToPlaylist }]

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    artist: { color: colours.accent, fontSize: SIZES.text },
    discTitle: { color: colours.muted, fontSize: SIZES.textSm, paddingVertical: SIZES.space1 },
    number: {
      color: colours.muted,
      fontSize: SIZES.textSm,
      width: SIZES.space5,
      textAlign: 'right',
    },
  }),
)

type TrackRowProps = {
  track: AlbumTrack
  isPlaying: boolean
  onPress: () => void
  /** Held, or the screen reader's action: adds the track to a playlist. */
  onAddToPlaylist: () => void
}

/**
 * One track: its number, its title and its length, pressed to play the album from it and held
 * to add it to a playlist.
 */
const TrackRow = ({ track, isPlaying, onPress, onAddToPlaylist }: TrackRowProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  const onAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === ROW_ACTIONS.addToPlaylist) onAddToPlaylist()
  }
  return (
    <Pressable
      accessibilityActions={TRACK_ACTIONS}
      accessibilityLabel={track.label}
      accessibilityRole="button"
      accessibilityState={{ selected: isPlaying }}
      onAccessibilityAction={onAction}
      onLongPress={onAddToPlaylist}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text style={[own.number, isPlaying && styles.on]}>{track.number}</Text>
      <Text numberOfLines={1} style={[styles.rowTitle, styles.grow, isPlaying && styles.on]}>
        {track.title}
      </Text>
      <Text style={styles.length}>{track.length}</Text>
    </Pressable>
  )
}

/** What one Add to playlist sheet is for: a track by its place and title, or the album's whole. */
type AddFromProps = { index: number | null; name: string }

/** An album under the thumb: one page scrolled, the cover over the actions and the tracks. */
export const AlbumLayout = ({
  title,
  artists,
  facts,
  cover,
  discs,
  playingId,
  onPlay,
  onShuffle,
  onPlayNext,
  onAddToQueue,
  onPlayFrom,
  onOpenArtist,
  isFavourite,
  onFavourite,
  playlists,
  onAddToPlaylist,
  note,
  onBack,
}: AlbumLayoutProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  const addFrom = ({ index, name }: AddFromProps) =>
    openAddToPlaylistSheet({
      title: MUSIC_COPY.addTrackToPlaylist(name),
      playlists,
      onPick: (pick) => onAddToPlaylist({ pick, index }),
    })
  return (
    <TouchPage onBack={onBack}>
      <View style={styles.stage}>
        <Cover cover={cover} title={title} />
        <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {artists.map((artist) => (
          <Pressable
            key={artist.id}
            accessibilityRole="link"
            onPress={() => onOpenArtist(artist.id)}
          >
            <Text style={own.artist}>{artist.name}</Text>
          </Pressable>
        ))}
        <Text style={styles.muted}>{facts}</Text>
        <View style={styles.controls}>
          <FormButton label={MUSIC_COPY.play} onPress={onPlay} tone={BUTTON_TONES.primary} />
          <FormButton label={MUSIC_COPY.shuffle} onPress={onShuffle} tone={BUTTON_TONES.quiet} />
        </View>
        <View style={styles.controls}>
          <ToolButton
            accessibilityLabel={MUSIC_COPY.playNext}
            icon="skipNext"
            label={MUSIC_COPY.playNext}
            onPress={onPlayNext}
          />
          <ToolButton
            accessibilityLabel={MUSIC_COPY.addToQueue}
            icon="plus"
            label={MUSIC_COPY.addToQueue}
            onPress={onAddToQueue}
          />
          <ToolButton
            accessibilityLabel={MUSIC_COPY.addToPlaylist}
            icon="list"
            label={MUSIC_COPY.addToPlaylist}
            onPress={() => addFrom({ index: null, name: title })}
          />
          <FavouriteButton isFavourite={isFavourite} onToggle={onFavourite} />
        </View>
        {note !== null && <Text style={styles.muted}>{note}</Text>}
      </View>
      {discs.map((disc) => (
        <View key={disc.key} style={styles.list}>
          {disc.title !== null && <Text style={own.discTitle}>{disc.title}</Text>}
          {disc.tracks.map((track) => (
            <TrackRow
              key={track.key}
              isPlaying={playingId === track.id}
              onAddToPlaylist={() => addFrom({ index: track.index, name: track.title })}
              onPress={() => onPlayFrom(track.index)}
              track={track}
            />
          ))}
        </View>
      ))}
    </TouchPage>
  )
}
