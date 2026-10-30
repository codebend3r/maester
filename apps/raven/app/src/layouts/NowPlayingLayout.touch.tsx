import { StyleSheet, View } from 'react-native'

import { BUTTON_TONES } from '@/layouts/formKit'
import { touchForm } from '@/layouts/Form.touch'
import {
  MUSIC_COPY,
  type NowPlayingLayoutProps,
  REPEAT_LABELS,
  shuffleLabelOf,
  toggleLabelOf,
} from '@/layouts/musicKit'
import { NowPlayingAside } from '@/layouts/NowPlayingAside.touch'
import { Cover, ListEntry, TouchPage, useMusicStyles } from '@/layouts/MusicParts.touch'
import { touchPicker } from '@/layouts/Picker.touch'
import { openAddToPlaylistSheet } from '@/layouts/playlistSheets'
import { Text } from '@/layouts/Text'
import { SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

const { FormButton } = touchForm
const { ToolButton } = touchPicker

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    trackTitle: {
      color: colours.text,
      fontSize: SIZES.textLg,
      fontWeight: '600',
      textAlign: 'center',
    },
    time: { color: colours.muted, fontSize: SIZES.textSm, fontVariant: ['tabular-nums'] },
    queueHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  }),
)

/** Now Playing under the thumb: the cover large, the controls, then the queue to scroll. */
export const NowPlayingLayout = ({
  track,
  error,
  time,
  isPlaying,
  isShuffled,
  repeat,
  queue,
  onToggle,
  onPrevious,
  onNext,
  onShuffle,
  onRepeat,
  onClear,
  onJump,
  onRemove,
  aside,
  playlists,
  onAddToPlaylist,
  note,
  onBack,
}: NowPlayingLayoutProps) => {
  const styles = useMusicStyles()
  const own = useStyles()
  return (
    <TouchPage onBack={onBack}>
      <Text accessibilityRole="header" style={styles.heading}>
        {MUSIC_COPY.nowPlaying}
      </Text>
      {track === null && <Text style={styles.muted}>{MUSIC_COPY.nothingPlaying}</Text>}
      {track !== null && (
        <View style={styles.stage}>
          <Cover cover={track.cover} title={track.title} />
          <Text numberOfLines={2} style={own.trackTitle}>
            {track.title}
          </Text>
          <Text numberOfLines={1} style={styles.muted}>
            {track.artists}
          </Text>
          <Text numberOfLines={1} style={styles.muted}>
            {track.album}
          </Text>
          {error !== null && <Text style={styles.error}>{error}</Text>}
          <Text style={own.time}>{time}</Text>
          <View style={styles.controls}>
            <FormButton
              label={MUSIC_COPY.previous}
              onPress={onPrevious}
              tone={BUTTON_TONES.quiet}
            />
            <FormButton
              label={toggleLabelOf(isPlaying)}
              onPress={onToggle}
              tone={BUTTON_TONES.primary}
            />
            <FormButton label={MUSIC_COPY.next} onPress={onNext} tone={BUTTON_TONES.quiet} />
          </View>
          <View style={styles.controls}>
            <ToolButton
              accessibilityLabel={shuffleLabelOf(isShuffled)}
              label={shuffleLabelOf(isShuffled)}
              onPress={onShuffle}
            />
            <ToolButton
              accessibilityLabel={REPEAT_LABELS[repeat]}
              label={REPEAT_LABELS[repeat]}
              onPress={onRepeat}
            />
            <ToolButton
              accessibilityLabel={MUSIC_COPY.addToPlaylist}
              label={MUSIC_COPY.addToPlaylist}
              onPress={() =>
                openAddToPlaylistSheet({
                  title: MUSIC_COPY.addTrackToPlaylist(track.title),
                  playlists,
                  onPick: onAddToPlaylist,
                })
              }
            />
          </View>
          {note !== null && <Text style={styles.muted}>{note}</Text>}
        </View>
      )}
      <NowPlayingAside aside={aside} />
      {queue.length > 0 && (
        <View style={styles.section}>
          <View style={own.queueHead}>
            <Text accessibilityRole="header" style={styles.heading}>
              {MUSIC_COPY.upNext}
            </Text>
            <ToolButton
              accessibilityLabel={MUSIC_COPY.clear}
              label={MUSIC_COPY.clear}
              onPress={onClear}
            />
          </View>
          {queue.map((row) => (
            <ListEntry
              key={row.key}
              isSelected={row.isCurrent}
              label={row.title}
              line={row.line}
              onPress={() => onJump(row.place)}
              title={row.title}
            >
              <ToolButton
                accessibilityLabel={MUSIC_COPY.removeTrack(row.title)}
                label={MUSIC_COPY.remove}
                onPress={() => onRemove(row.place)}
              />
            </ListEntry>
          ))}
        </View>
      )}
    </TouchPage>
  )
}
