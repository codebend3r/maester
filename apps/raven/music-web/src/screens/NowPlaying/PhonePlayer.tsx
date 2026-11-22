import { classNames } from '@raven/ui/headless'
import { PANES, type Pane, TRANSPORTS, paneAfter } from '@raven/wren'
import { type ComponentType, type ReactNode, useState } from 'react'
import { SCRUBBERS, Scrubber } from '@/player/Scrubber/Scrubber'
import { Transport } from '@/player/Transport/Transport'
import { BottomBar } from '@/screens/NowPlaying/BottomBar'
import { LyricsView } from '@/screens/NowPlaying/LyricsView'
import { PlayerHeader } from '@/screens/NowPlaying/PlayerHeader'
import { PlayerStack } from '@/screens/NowPlaying/PlayerStack'
import { CompactSong } from '@/screens/NowPlaying/SongTitle'
import { UP_NEXT_PLACES, UpNext } from '@/screens/NowPlaying/UpNext'
import type { Playing } from '@/screens/NowPlaying/usePlaying'
import styles from '@/screens/NowPlaying/PhonePlayer.module.scss'

type PaneProps = {
  playing: Playing
  /** Where the sheet places the pane. */
  className: string
}

type CompactPaneProps = PaneProps & {
  /** What fills the middle: the lyrics, or Up next. */
  body: ReactNode
  /** What sits under it: the scrubber and the transport, or the transport alone. */
  controls: ReactNode
}

/** A pane under the song's compact head, its controls along its foot. */
function CompactPane({ playing, className, body, controls }: CompactPaneProps) {
  return (
    <div className={classNames([styles.compactPane, className])}>
      <div className={styles.compact}>
        <CompactSong playing={playing} />
      </div>
      <div className={styles.body}>{body}</div>
      <div className={styles.controls}>{controls}</div>
    </div>
  )
}

/** The lyrics, the scrubber and transport under them. */
function LyricsPane({ playing, className }: PaneProps) {
  return (
    <CompactPane
      body={
        <div className={styles.lyrics}>
          <LyricsView lyrics={playing.lyrics} />
        </div>
      }
      controls={
        <>
          <Scrubber kind={SCRUBBERS.player} length={playing.length} />
          <Transport kind={TRANSPORTS.lyrics} />
        </>
      }
      className={className}
      playing={playing}
    />
  )
}

/** What plays next, the transport under it. */
function UpNextPane({ playing, className }: PaneProps) {
  return (
    <CompactPane
      body={<UpNext place={UP_NEXT_PLACES.sheet} sourceName={playing.title.sourceName} />}
      className={className}
      controls={<Transport kind={TRANSPORTS.queue} />}
      playing={playing}
    />
  )
}

const PANE_VIEWS = {
  [PANES.player]: PlayerStack,
  [PANES.lyrics]: LyricsPane,
  [PANES.upNext]: UpNextPane,
} as const satisfies Record<Pane, ComponentType<PaneProps>>

type PhonePlayerProps = { playing: Playing; onMore: () => void }

/**
 * The narrow Now Playing, over everything: the header, the pane picked (the player, the lyrics
 * or Up next) and the bar along the foot that picks it.
 */
export function PhonePlayer({ playing, onMore }: PhonePlayerProps) {
  const [pane, setPane] = useState<Pane>(PANES.player)
  const PaneView = PANE_VIEWS[pane]
  return (
    <div className={styles.sheet}>
      <div className={styles.header}>
        <PlayerHeader onClose={playing.close} onMore={onMore} title={playing.title} />
      </div>
      <PaneView className={styles.pane} playing={playing} />
      <div className={styles.bar}>
        <BottomBar
          onPane={(pressed) => setPane(paneAfter({ current: pane, pressed }))}
          output={playing.output}
          pane={pane}
        />
      </div>
    </div>
  )
}
