import {
  type MediaTracks,
  PLAYBACK_MODES,
  type PlaybackMode,
  SUBTITLE_SOURCES,
  type SubtitleTrack,
} from '@raven/core'
import type { SidecarSource } from '@raven/native/headless'
import { SelectedTrackType, TextTrackType } from 'react-native-video'

import type { VideoSurface } from '@/layouts/playerKit'
import { filePlaceFor, subtitlePlaceFor } from '@/player/playerTracks'

type TextTrackPick = NonNullable<VideoSurface['selectedTextTrack']>

type SidecarTracks = NonNullable<NonNullable<VideoSurface['source']>['textTracks']>

const NO_TEXT_TRACK = { type: SelectedTrackType.DISABLED } as const satisfies TextTrackPick

/** The subtitles as they are shown: the track raven draws the cues of, and the one the player draws itself. */
export type Captions = {
  cueTrack: SubtitleTrack | null
  textTrack: TextTrackPick
}

type DirectTrackOfProps = { tracks: MediaTracks; picked: SubtitleTrack }

/**
 * A track of the file the player plays as it is: a sidecar by the title it was handed to the
 * player under (`sidecarTracksOf`), one inside the file by its place among the file's own.
 */
const directTrackOf = ({ tracks, picked }: DirectTrackOfProps): TextTrackPick => {
  if (picked.source === SUBTITLE_SOURCES.external) {
    return { type: SelectedTrackType.TITLE, value: picked.id }
  }
  const place = filePlaceFor({ tracks, subtitle: picked.id })
  return place === null ? NO_TEXT_TRACK : { type: SelectedTrackType.INDEX, value: place }
}

type CaptionsForProps = {
  mode: PlaybackMode | null
  tracks: MediaTracks | null
  subtitle: string | null
  /** Whether the server burns the picked picture subtitle into the picture, which then draws it. */
  isBurning: boolean
  /** Whether this device's chrome draws the cues itself, from the server's WebVTT. */
  shouldDrawCaptions: boolean
  /** Whether this device's player draws a picture track of the file it plays as it is. */
  canDrawPictureSubtitles: boolean
}

/**
 * Who draws the picked subtitle. Where the chrome draws the cues, raven reads them from
 * `cueTrack`, and the player's own track is never picked, so it never draws a second. Elsewhere
 * the player draws them itself on its own clock, as Plex's does (`textTrack`): the file's track
 * or its sidecar while the file plays as it is, the stream's rendition otherwise. A picture
 * track is only ever the player's, from the file, since there is no text in it to draw.
 */
export const captionsFor = ({
  mode,
  tracks,
  subtitle,
  isBurning,
  shouldDrawCaptions,
  canDrawPictureSubtitles,
}: CaptionsForProps): Captions => {
  const nothing: Captions = { cueTrack: null, textTrack: NO_TEXT_TRACK }
  const picked = tracks?.subtitles.find((track) => track.id === subtitle) ?? null
  if (isBurning || picked === null || tracks === null || mode === null) return nothing
  const isDirect = mode === PLAYBACK_MODES.direct
  // A track with no text in it: a picture inside the file is the player's alone to draw.
  if (!picked.supported) {
    const canDraw =
      isDirect && canDrawPictureSubtitles && picked.source === SUBTITLE_SOURCES.embedded
    return canDraw ? { cueTrack: null, textTrack: directTrackOf({ tracks, picked }) } : nothing
  }
  if (shouldDrawCaptions) return { cueTrack: picked, textTrack: NO_TEXT_TRACK }
  if (isDirect) return { cueTrack: null, textTrack: directTrackOf({ tracks, picked }) }
  const place = subtitlePlaceFor({ mode, tracks, subtitle: picked.id })
  return {
    cueTrack: null,
    textTrack: place === null ? NO_TEXT_TRACK : { type: SelectedTrackType.INDEX, value: place },
  }
}

/** The sidecar tracks a player that draws the subtitles itself loads beside the file, by id. */
export const sidecarIdsOf = (tracks: MediaTracks | null): string[] =>
  (tracks?.subtitles ?? [])
    .filter((track) => track.source === SUBTITLE_SOURCES.external && track.supported)
    .map((track) => track.id)

type SidecarTracksOfProps = {
  /** The sidecars the source came with, each addressed by the source's own ticket. */
  sidecars: readonly SidecarSource[]
  tracks: MediaTracks | null
}

/**
 * A source's sidecar subtitles as the player loads them beside the file it plays as it is: the
 * server's WebVTT of each, titled by the track's id, which is how `captionsFor` picks one. All
 * of them go with the source, so picking another never opens the video again.
 */
export const sidecarTracksOf = ({ sidecars, tracks }: SidecarTracksOfProps): SidecarTracks =>
  sidecars.map(({ trackId, uri }) => ({
    title: trackId,
    language: tracks?.subtitles.find((track) => track.id === trackId)?.language ?? '',
    type: TextTrackType.VTT,
    uri,
  }))
