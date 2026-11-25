import { type AudioQuality, type Track, type TrackStream, audioQualityOf } from '@raven/core'
import { create } from 'zustand'
import type { TrackPlan } from '@/music/audioItem'

type HeardProps = { trackId: number; stream: TrackStream }

type PlayedStreams = {
  /** What each track last played from, by its id; none until its source was made. */
  streams: Readonly<Record<number, TrackStream>>
  /** Keeps what a track plays from, as the host makes its source. */
  heard: (props: HeardProps) => void
}

/**
 * What the tracks the music host has made a source for play from: a download, the server's
 * transcode or the file itself. Now Playing says it under the song in the device app and in
 * Wren alike, so both name the stream that was chosen, never a guess from the track's own file.
 */
export const usePlayedStreams = create<PlayedStreams>()((set) => ({
  streams: {},
  heard: ({ trackId, stream }) =>
    set(({ streams }) => ({ streams: { ...streams, [trackId]: stream } })),
}))

/** A plan's `onStream` that keeps what each track plays from, for Now Playing to say. */
export const keepPlayedStream: TrackPlan['onStream'] = ({ track, stream }) =>
  usePlayedStreams.getState().heard({ trackId: track.id, stream })

type UsePlayedQualityProps = { track: Track | null }

/**
 * The format and quality of what a track plays, read from the stream the host made for it; null
 * for no track and until its source is made, so nothing is said of a stream not yet chosen.
 */
export const usePlayedQuality = ({ track }: UsePlayedQualityProps): AudioQuality | null => {
  const stream = usePlayedStreams((played) =>
    track === null ? undefined : played.streams[track.id],
  )
  return track === null || stream === undefined ? null : audioQualityOf({ track, stream })
}
