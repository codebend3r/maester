import { classNames } from '@raven/ui/headless'
import { type SongActions, TRANSPORTS } from '@raven/wren'
import { SCRUBBERS, Scrubber } from '@/player/Scrubber/Scrubber'
import { Transport } from '@/player/Transport/Transport'
import { PlayerCover } from '@/screens/NowPlaying/PlayerCover'
import { PlayerExtras } from '@/screens/NowPlaying/PlayerExtras'
import { SongTitle } from '@/screens/NowPlaying/SongTitle'
import type { Playing } from '@/screens/NowPlaying/usePlaying'
import styles from '@/screens/NowPlaying/PlayerStack.module.scss'

type PlayerStackProps = {
  playing: Playing
  actions: SongActions
  /** Where the layout places the pane. */
  className: string
}

/**
 * The player, as the narrow layout's player pane and the wide layout's first column draw it:
 * the cover large, the song with its heart and Add to playlist, the scrubber over its times,
 * Previous, Play or Pause and Next, the volume and a book's speed. The stylesheet fits the cover
 * to the window, so a short one still holds the controls.
 */
export function PlayerStack({ playing, actions, className }: PlayerStackProps) {
  return (
    <div className={classNames([styles.player, className])}>
      <PlayerCover className={styles.cover} cover={playing.cover} track={playing.track} />
      <SongTitle like={actions.like} onAddToPlaylist={actions.onAddToPlaylist} playing={playing} />
      <Scrubber kind={SCRUBBERS.player} length={playing.length} />
      <Transport kind={TRANSPORTS.player} />
      <PlayerExtras isAudiobook={playing.isAudiobook} />
    </div>
  )
}
