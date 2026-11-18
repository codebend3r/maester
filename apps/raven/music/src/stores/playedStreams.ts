import type { TrackStream } from '@raven/native/headless'
import { create } from 'zustand'

type HeardProps = { trackId: number; stream: TrackStream }

type PlayedStreams = {
  /** What each track last played from, by its id; none until its source was made. */
  streams: Readonly<Record<number, TrackStream>>
  /** Keeps what a track plays from, as the host makes its source. */
  heard: (props: HeardProps) => void
}

/** What the tracks the host has made a source for play from, which Now Playing says under the song. */
export const usePlayedStreams = create<PlayedStreams>()((set) => ({
  streams: {},
  heard: ({ trackId, stream }) =>
    set(({ streams }) => ({ streams: { ...streams, [trackId]: stream } })),
}))
