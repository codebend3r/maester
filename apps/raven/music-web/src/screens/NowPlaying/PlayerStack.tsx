import { classNames } from '@raven/ui/headless'
import { TRANSPORTS } from '@raven/wren'
import { SCRUBBERS, Scrubber } from '@/player/Scrubber/Scrubber'
import { Transport } from '@/player/Transport/Transport'
import { PlayerCover } from '@/screens/NowPlaying/PlayerCover'
import { PlayerExtras } from '@/screens/NowPlaying/PlayerExtras'
import { SongTitle } from '@/screens/NowPlaying/SongTitle'
import type { Playing } from '@/screens/NowPlaying/usePlaying'
import styles from '@/screens/NowPlaying/PlayerStack.module.scss'

type PlayerStackProps = {
  playing: Playing
  /** Where the layout places the pane. */
  className: string
}

/**
 * The player, as the narrow layout's player pane draws it: the cover large, the song, the
 * scrubber, the transport, the volume and a book's speed. The stylesheet fits the cover to the
 * window, so a short one still holds the controls.
 */
export function PlayerStack({ playing, className }: PlayerStackProps) {
  return (
    <div className={classNames([styles.player, className])}>
      <PlayerCover className={styles.cover} cover={playing.cover} />
      <SongTitle playing={playing} />
      <Scrubber kind={SCRUBBERS.player} length={playing.length} />
      <Transport kind={TRANSPORTS.player} />
      <PlayerExtras isAudiobook={playing.isAudiobook} />
    </div>
  )
}
