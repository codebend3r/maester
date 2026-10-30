import { type ComponentRef, useRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { FocusBand } from '@/layouts/FocusBand'
import { useOpenerFocus, useOpeningFocus, useScreenFocusScope } from '@/layouts/focus'
import { BUTTON_TONES } from '@/layouts/formKit'
import { useToneStyles } from '@/layouts/formStyles'
import { type AlbumLayoutProps, MUSIC_COPY } from '@/layouts/musicKit'
import {
  ActionPlate,
  Cover,
  FavouriteButton,
  FocusPage,
  FocusRow,
  useMusicStyles,
} from '@/layouts/MusicParts.focus'
import type { AlbumTrack } from '@/layouts/musicRows'
import { Text } from '@/layouts/Text'
import { tvSize } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

/** An album's cover on its page, beside the words. */
const ALBUM_COVER = tvSize(420)

const useStyles = themedStyles((colours) => StyleSheet.create({ link: { color: colours.accent } }))

type ArtistLinkProps = { artistId: number; name: string; onOpen: (artistId: number) => void }

/** An album's artist, the way to their page; Back from it lands here again. */
const ArtistLink = ({ artistId, name, onOpen }: ArtistLinkProps) => {
  const view = useRef<ComponentRef<typeof Pressable>>(null)
  const { settle } = useOpeningFocus()
  const { remember } = useOpenerFocus({ place: `artist:${artistId}`, view })
  const styles = useMusicStyles()
  const linkStyles = useStyles()
  const toneStyles = useToneStyles()
  return (
    <Pressable
      ref={view}
      accessibilityLabel={MUSIC_COPY.goTo(name)}
      accessibilityRole="link"
      onFocus={settle}
      onPress={() => {
        remember()
        onOpen(artistId)
      }}
      style={({ focused }) => [
        styles.action,
        toneStyles[BUTTON_TONES.ghost].button,
        focused && styles.focused,
      ]}
    >
      <Text style={[styles.actionLabel, linkStyles.link]}>{name}</Text>
    </Pressable>
  )
}

type TrackRowProps = { track: AlbumTrack; isPlaying: boolean; onPress: () => void }

/** One track, the remote's to move down to: its number, title and length, ringed while focused. */
const TrackRow = ({ track, isPlaying, onPress }: TrackRowProps) => {
  const styles = useMusicStyles()
  return (
    <FocusRow isSelected={isPlaying} label={track.label} onPress={onPress}>
      <Text style={[styles.number, isPlaying && styles.on]}>{track.number}</Text>
      <Text numberOfLines={1} style={[styles.rowTitle, isPlaying && styles.on]}>
        {track.title}
      </Text>
      <Text style={styles.muted}>{track.length}</Text>
    </FocusRow>
  )
}

/**
 * An album on a TV: the cover beside its name, artists and facts, and the actions the remote
 * opens on, Play first; below them each disc's tracks in a band of its own, so Down from the
 * actions lands on the first track. Menu goes back.
 */
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
}: AlbumLayoutProps) => {
  const { isOpening } = useScreenFocusScope()
  const styles = useMusicStyles()
  return (
    <FocusPage>
      <FocusBand>
        <View style={styles.hero}>
          <Cover cover={cover} size={ALBUM_COVER} title={title} />
          <View style={styles.words}>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Text style={styles.muted}>{facts}</Text>
            <View style={styles.actions}>
              <ActionPlate
                icon="play"
                isPreferred={isOpening}
                label={MUSIC_COPY.play}
                onPress={onPlay}
                text={MUSIC_COPY.play}
                tone={BUTTON_TONES.primary}
              />
              <ActionPlate
                icon="shuffle"
                isPreferred={false}
                label={MUSIC_COPY.shuffle}
                onPress={onShuffle}
                text={MUSIC_COPY.shuffle}
                tone={BUTTON_TONES.quiet}
              />
              <ActionPlate
                icon={null}
                isPreferred={false}
                label={MUSIC_COPY.playNext}
                onPress={onPlayNext}
                text={MUSIC_COPY.playNext}
                tone={BUTTON_TONES.quiet}
              />
              <ActionPlate
                icon={null}
                isPreferred={false}
                label={MUSIC_COPY.addToQueue}
                onPress={onAddToQueue}
                text={MUSIC_COPY.addToQueue}
                tone={BUTTON_TONES.quiet}
              />
              <FavouriteButton isFavourite={isFavourite} onToggle={onFavourite} />
            </View>
            {artists.length > 0 && (
              <View style={styles.actions}>
                {artists.map((artist) => (
                  <ArtistLink
                    key={artist.id}
                    artistId={artist.id}
                    name={artist.name}
                    onOpen={onOpenArtist}
                  />
                ))}
              </View>
            )}
          </View>
        </View>
      </FocusBand>
      {discs.map((disc) => (
        <FocusBand key={disc.key}>
          <View style={styles.section}>
            {disc.title !== null && (
              <Text accessibilityRole="header" style={styles.heading}>
                {disc.title}
              </Text>
            )}
            {disc.tracks.map((track) => (
              <TrackRow
                key={track.key}
                isPlaying={playingId === track.id}
                onPress={() => onPlayFrom(track.index)}
                track={track}
              />
            ))}
          </View>
        </FocusBand>
      ))}
    </FocusPage>
  )
}
