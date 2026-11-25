import {
  NOW_PLAYING_COPY,
  PANES,
  SIDE_PANE_CHOICES,
  type SidePane,
  type SongActions,
} from '@raven/wren'
import { type ComponentType, useState } from 'react'
import { LyricsView } from '@/screens/NowPlaying/LyricsView'
import { PlayerHeader } from '@/screens/NowPlaying/PlayerHeader'
import { PlayerStack } from '@/screens/NowPlaying/PlayerStack'
import { UP_NEXT_PLACES, UpNext } from '@/screens/NowPlaying/UpNext'
import type { Playing } from '@/screens/NowPlaying/usePlaying'
import { COLORS, SIZES } from '@/theme/tokens'
import { SegmentedControl } from '@/ui/SegmentedControl/SegmentedControl'
import { ICONS } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/screens/NowPlaying/TabletPlayer.module.scss'

type SidePaneProps = { playing: Playing }

/** What plays next, under what changes the queue: Shuffle, Repeat and Clear. */
function UpNextTab({ playing }: SidePaneProps) {
  return <UpNext place={UP_NEXT_PLACES.panel} sourceName={playing.title.sourceName} />
}

/** The song's words. */
function LyricsTab({ playing }: SidePaneProps) {
  return <LyricsView lyrics={playing.lyrics} />
}

const SIDE_PANE_VIEWS = {
  [PANES.upNext]: UpNextTab,
  [PANES.lyrics]: LyricsTab,
} as const satisfies Record<SidePane, ComponentType<SidePaneProps>>

type TabletPlayerProps = { playing: Playing; actions: SongActions }

/**
 * The wide Now Playing, the whole screen in two columns. The first is the player, as the narrow
 * layout draws it: the header, the cover, the song, the scrubber, the transport and the volume.
 * The second is one pane of two tabs, Up next (which it opens on) and Lyrics, under where the
 * music plays.
 */
export function TabletPlayer({ playing, actions }: TabletPlayerProps) {
  const [pane, setPane] = useState<SidePane>(SIDE_PANE_CHOICES[0].key)
  const PaneView = SIDE_PANE_VIEWS[pane]
  return (
    <div className={styles.screen}>
      <div className={styles.player}>
        <div className={styles.header}>
          <PlayerHeader onClose={playing.close} onMore={actions.onMore} title={playing.title} />
        </div>
        <PlayerStack actions={actions} className={styles.stack} playing={playing} />
      </div>
      <div className={styles.side}>
        <div className={styles.sideHead}>
          <SegmentedControl
            choices={SIDE_PANE_CHOICES}
            label={NOW_PLAYING_COPY.sidePanes}
            onSelect={setPane}
            selected={pane}
          />
          <p className={styles.output}>
            <WrenIcon color={COLORS.text2} name={ICONS.output} size={SIZES.smallIcon} />
            <span className={styles.outputText}>{playing.playingOn}</span>
          </p>
        </div>
        <div className={styles.sideBody}>
          <PaneView playing={playing} />
        </div>
      </div>
    </div>
  )
}
