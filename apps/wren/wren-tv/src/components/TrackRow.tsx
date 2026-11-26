import type { Track } from '@raven/core'
import type { SongLeadOf } from '@raven/wren'
import { isPlayingOf, useAudioQueue } from '@raven/ui/headless'
import { useState } from 'react'

import { TrackMenu } from '@/components/TracksMenu'
import { type Cover, useTrackLike, type WrenSession, useWren } from '@raven/wren-native'
import { SongRow } from '@/ui/SongRow'

type RowMenuProps = { session: WrenSession; track: Track; onClose: () => void }

/** The row's menu, which reads the song's Like only while it is open, since the row draws no heart. */
function RowMenu({ session, track, onClose }: RowMenuProps) {
  const like = useTrackLike({ session, track })
  return <TrackMenu like={like} onClose={onClose} track={track} />
}

type TrackRowProps = {
  track: Track
  /** Its number on its album's page, or its cover in a list of many albums' songs. */
  lead: SongLeadOf<Cover>
  /** What sits under the title: the artists, or nothing on their own album. */
  subtitle?: string | null
  length: string
  /** What the row is called aloud. */
  label: string
  /** Whether it is the queue's track. */
  isCurrent: boolean
  onPress: () => void
  hasPreferredFocus?: boolean
}

/**
 * A track in a list: a press plays from it, and holding select on it, or its More, opens its
 * menu: Like, Play next, Add to queue, Add to playlist, Go to album and Go to artist.
 */
export function TrackRow({
  track,
  lead,
  subtitle = null,
  length,
  label,
  isCurrent,
  onPress,
  hasPreferredFocus,
}: TrackRowProps) {
  const session = useWren()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const isPlaying = useAudioQueue((store) => isCurrent && isPlayingOf(store))
  return (
    <>
      <SongRow
        duration={length}
        hasPreferredFocus={hasPreferredFocus}
        isCurrent={isCurrent}
        isPlaying={isPlaying}
        label={label}
        lead={lead}
        onMore={() => setIsMenuOpen(true)}
        onPress={onPress}
        subtitle={subtitle}
        title={track.title}
      />
      {session !== null && isMenuOpen && (
        <RowMenu onClose={() => setIsMenuOpen(false)} session={session} track={track} />
      )}
    </>
  )
}
