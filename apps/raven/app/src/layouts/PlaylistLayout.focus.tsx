import type { ComponentType } from 'react'
import { StyleSheet, View } from 'react-native'

import { FocusBand } from '@/layouts/FocusBand'
import { useScreenFocusScope } from '@/layouts/focus'
import { BUTTON_TONES } from '@/layouts/formKit'
import { MUSIC_COPY } from '@/layouts/copy'
import { type PlaylistLayoutProps } from '@/layouts/musicKit'
import { ActionPlate, FocusPage, FocusRow, useMusicStyles } from '@/layouts/MusicParts.focus'
import type { PlaylistTrack } from '@/layouts/musicRows'
import { Text } from '@/layouts/Text'

const styles = StyleSheet.create({ entryWords: { flex: 1 } })

type PlaylistEntryProps = {
  track: PlaylistTrack
  isPlaying: boolean
  onPlayFrom: (index: number) => void
}

/** A track of a playlist, pressed to play the playlist from it. */
const PlaylistEntry = ({ track, isPlaying, onPlayFrom }: PlaylistEntryProps) => {
  const music = useMusicStyles()
  return (
    <FocusRow isSelected={isPlaying} label={track.label} onPress={() => onPlayFrom(track.index)}>
      <Text style={music.number}>{String(track.index + 1)}</Text>
      <View style={styles.entryWords}>
        <Text numberOfLines={1} style={[music.rowTitle, isPlaying && music.on]}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={music.muted}>
          {track.line}
        </Text>
      </View>
      <Text style={music.muted}>{track.length}</Text>
    </FocusRow>
  )
}

/** Whether a playlist holds any tracks to list. */
const PLAYLIST_FILLS = { empty: 'empty', filled: 'filled' } as const

type PlaylistFill = (typeof PLAYLIST_FILLS)[keyof typeof PLAYLIST_FILLS]

const playlistFillOf = (tracks: readonly PlaylistTrack[]): PlaylistFill =>
  tracks.length === 0 ? PLAYLIST_FILLS.empty : PLAYLIST_FILLS.filled

type PlaylistTracksProps = Pick<PlaylistLayoutProps, 'name' | 'tracks' | 'playingId' | 'onPlayFrom'>

type EmptyTracksProps = PlaylistTracksProps

/** A word that the playlist holds nothing yet. */
const EmptyTracks = ({ name }: EmptyTracksProps) => {
  const music = useMusicStyles()
  return <Text style={music.line}>{MUSIC_COPY.emptyPlaylist(name)}</Text>
}

type TrackBandProps = PlaylistTracksProps

/** The playlist's tracks in a band of their own. */
const TrackBand = ({ tracks, playingId, onPlayFrom }: TrackBandProps) => {
  const music = useMusicStyles()
  return (
    <FocusBand>
      <View style={music.section}>
        {tracks.map((track) => (
          <PlaylistEntry
            key={track.key}
            isPlaying={playingId === track.id}
            onPlayFrom={onPlayFrom}
            track={track}
          />
        ))}
      </View>
    </FocusBand>
  )
}

/** What stands below the actions: the tracks, or a word that there are none. */
const PLAYLIST_TRACKS = {
  [PLAYLIST_FILLS.empty]: EmptyTracks,
  [PLAYLIST_FILLS.filled]: TrackBand,
} as const satisfies Record<PlaylistFill, ComponentType<PlaylistTracksProps>>

/**
 * A playlist on a TV: its name and facts over Play and Shuffle, which the remote opens on, then
 * its tracks in a band of their own to play from. Its edits stay under the thumb. Menu goes back.
 */
export const PlaylistLayout = ({
  name,
  facts,
  tracks,
  playingId,
  onPlay,
  onShuffle,
  onPlayFrom,
}: PlaylistLayoutProps) => {
  const { isOpening } = useScreenFocusScope()
  const music = useMusicStyles()
  const Tracks = PLAYLIST_TRACKS[playlistFillOf(tracks)]
  return (
    <FocusPage>
      <FocusBand>
        <View style={music.words}>
          <Text style={music.eyebrow}>{MUSIC_COPY.playlist}</Text>
          <Text accessibilityRole="header" style={music.title}>
            {name}
          </Text>
          <Text style={music.muted}>{facts}</Text>
          <View style={music.actions}>
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
          </View>
        </View>
      </FocusBand>
      <Tracks name={name} onPlayFrom={onPlayFrom} playingId={playingId} tracks={tracks} />
    </FocusPage>
  )
}

/** A TV makes no playlist: naming one is the touch screens' and the web's. */
export const NewPlaylistButton = () => null
