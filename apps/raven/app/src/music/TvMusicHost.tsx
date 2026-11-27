import { PLAYBACK_MODES, TRACK_STREAM_KINDS } from '@raven/core'
import { VideoAudioHost, type VideoTrackSourceOf } from '@raven/native'
import { useMemo } from 'react'

import { mediaSourcesFor } from '@/player/mediaSources'
import type { AppQueries } from '@/queries/useAppQueries'

/** What a music host reads of the active server. */
type MusicSession = Pick<AppQueries, 'server' | 'api'>

type TvMusicHostProps = { session: MusicSession }

/**
 * Music on a TV through `@raven/native`'s `VideoAudioHost`: each track is asked for as a video's
 * file is, in direct mode, so once its address is made it plays from the file itself.
 */
export const TvMusicHost = ({ session }: TvMusicHostProps) => {
  const { server } = session
  const sourceOf = useMemo(
    (): VideoTrackSourceOf => (track) => ({
      load: () =>
        mediaSourcesFor(server).source({
          media: { id: track.id },
          mode: PLAYBACK_MODES.direct,
          audio: null,
          burn: null,
        }),
      stream: { kind: TRACK_STREAM_KINDS.file },
    }),
    [server],
  )
  return <VideoAudioHost session={session} sourceOf={sourceOf} />
}
