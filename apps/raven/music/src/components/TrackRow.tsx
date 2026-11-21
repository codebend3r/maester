import type { Track } from '@raven/core'
import { isPlayingOf, useAudioQueue } from '@raven/ui/headless'
import { useState } from 'react'
import { View } from 'react-native'
import { type SongLeadOf } from '@raven/wren'

import type { Cover } from '@/music/useCovers'
import { TrackMenu } from '@/components/TrackMenu'
import { useDownloads } from '@/downloads/downloadStore'
import { downloadedOf } from '@/downloads/downloadViews'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { RADIUS, SPACE } from '@/theme/wrenTokens'
import { SongRow } from '@/ui/SongRow'
import { useWren } from '@/useWren'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  inset: { borderRadius: RADIUS.item, paddingHorizontal: SPACE.s3 },
  highlighted: { backgroundColor: colors.accentSoft },
}))

/** Whether the active server's copy of a track is on the device. */
const useIsDownloaded = (id: number): boolean => {
  const serverId = useWren()?.server.id ?? null
  return useDownloads(
    (state) =>
      serverId !== null &&
      downloadedOf({ entries: state.entries, serverId, mediaId: id }) !== undefined,
  )
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
  /** Whether it is the queue's track: its title in red, and its number the equalizer. */
  isCurrent: boolean
  /** Whether the row sits inset and the queue's track stands out in a soft fill: a tablet's tracklist. */
  isHighlighted?: boolean
  onPress: () => void
}

/**
 * A track in a list: a press plays from it, and holding it, or its More, opens its sheet: Play
 * next, Add to queue, Add to playlist, Go to album and Go to artist. A downloaded track shows a
 * check.
 */
export function TrackRow({
  track,
  lead,
  subtitle = null,
  length,
  label,
  isCurrent,
  isHighlighted = false,
  onPress,
}: TrackRowProps) {
  const styles = useStyles()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const isPlaying = useAudioQueue((store) => isCurrent && isPlayingOf(store))
  const isDownloaded = useIsDownloaded(track.id)
  const openMenu = () => setIsMenuOpen(true)
  return (
    <View style={isHighlighted && [styles.inset, isCurrent && styles.highlighted]}>
      <SongRow
        duration={length}
        isCurrent={isCurrent}
        isDownloaded={isDownloaded}
        isPlaying={isPlaying}
        label={label}
        lead={lead}
        onLongPress={openMenu}
        onMore={openMenu}
        onPress={onPress}
        subtitle={subtitle}
        title={track.title}
      />
      {isMenuOpen && <TrackMenu onClose={() => setIsMenuOpen(false)} track={track} />}
    </View>
  )
}
