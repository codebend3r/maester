import {
  type MediaTracks,
  PLAYBACK_MODES,
  type PlaybackMode,
  type SubtitleTrack,
  type TrackLabel,
  audioLabel,
  subtitleLabel,
} from '@raven/core'

/** The subtitle picker's own choices beside the tracks: off, which no track id takes. */
export const SUBTITLE_CHOICES = { off: 'off' } as const

/** A choice in a track picker: its key and how it reads. */
type TrackOption = { key: string; label: string }

const labelText = ({ name, details }: TrackLabel): string =>
  details === '' ? name : `${name} · ${details}`

/** The file's audio tracks, keyed by their index. */
export const audioOptionsOf = (tracks: MediaTracks): TrackOption[] =>
  tracks.audio.map((track) => ({ key: String(track.index), label: labelText(audioLabel(track)) }))

/** The subtitle tracks a player can show: text ones, never pictures. */
const showable = (tracks: MediaTracks): SubtitleTrack[] =>
  tracks.subtitles.filter((track) => track.supported)

/** Subtitles off, then each track a player can show, keyed by its id. */
export const subtitleOptionsOf = (tracks: MediaTracks): TrackOption[] => [
  { key: SUBTITLE_CHOICES.off, label: 'Off' },
  ...showable(tracks).map((track) => ({ key: track.id, label: labelText(subtitleLabel(track)) })),
]

type AudioPlaceForProps = {
  mode: PlaybackMode
  tracks: MediaTracks
  audio: number | null
}

/**
 * Which of the player's audio tracks to play, by its place among them, or null to leave the
 * choice to the player. Direct play switches among the file's own tracks, which AVPlayer keeps
 * in the file's order. A stream carries only the one track the session asked the server for.
 */
export const audioPlaceFor = ({ mode, tracks, audio }: AudioPlaceForProps): number | null => {
  if (mode !== PLAYBACK_MODES.direct || audio === null) return null
  const place = tracks.audio.findIndex((track) => track.index === audio)
  return place < 0 ? null : place
}

type SubtitlePlaceForProps = {
  mode: PlaybackMode
  tracks: MediaTracks
  subtitle: string | null
}

/**
 * Which of a stream's subtitle renditions to show, by its place among them, or null to leave the
 * choice to the player. The server's master playlist lists a rendition for each text track, in
 * the file's order, and only a stream (remux or transcode) has them.
 */
export const subtitlePlaceFor = ({
  mode,
  tracks,
  subtitle,
}: SubtitlePlaceForProps): number | null => {
  if (mode === PLAYBACK_MODES.direct || subtitle === null) return null
  const place = showable(tracks).findIndex((track) => track.id === subtitle)
  return place < 0 ? null : place
}
