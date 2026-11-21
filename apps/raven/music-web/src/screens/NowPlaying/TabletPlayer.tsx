import { TRANSPORTS } from '@raven/wren'
import { SCRUBBERS, Scrubber } from '@/player/Scrubber/Scrubber'
import { Transport } from '@/player/Transport/Transport'
import { LyricsView } from '@/screens/NowPlaying/LyricsView'
import { PlayerCover } from '@/screens/NowPlaying/PlayerCover'
import { HEADER_TITLES, PlayerHeader } from '@/screens/NowPlaying/PlayerHeader'
import { PlayerExtras } from '@/screens/NowPlaying/PlayerExtras'
import { SongTitle } from '@/screens/NowPlaying/SongTitle'
import { UP_NEXT_PLACES, UpNext } from '@/screens/NowPlaying/UpNext'
import type { Playing } from '@/screens/NowPlaying/usePlaying'
import { COLORS, SIZES } from '@/theme/tokens'
import { ICONS } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/screens/NowPlaying/TabletPlayer.module.scss'

type TabletPlayerProps = { playing: Playing; onMore: () => void }

/**
 * The wide Now Playing, the whole screen in two rows. The first is two columns: the cover over
 * the controls, icons and lines with no words, in under a third of the width, and beside them
 * the song, where the music plays and the lyrics. The second, the screen's whole width, is Up
 * next: what the album, the playlist or the shuffle plays after this song. The stylesheet
 * divides the window as the apps' `tabletFitOf` does.
 */
export function TabletPlayer({ playing, onMore }: TabletPlayerProps) {
  const { title } = playing
  return (
    <div className={styles.screen}>
      <div className={styles.player}>
        <PlayerHeader
          onClose={playing.close}
          onMore={onMore}
          title={title}
          variant={HEADER_TITLES.none}
        />
        <PlayerCover className={styles.cover} cover={playing.cover} />
        <Scrubber kind={SCRUBBERS.bare} length={playing.length} />
        <Transport kind={TRANSPORTS.column} />
        <PlayerExtras isAudiobook={playing.isAudiobook} />
      </div>
      <div className={styles.lyrics}>
        <div className={styles.lyricsHead}>
          <SongTitle playing={playing} />
          <p className={styles.output}>
            <WrenIcon color={COLORS.text2} name={ICONS.output} size={SIZES.smallIcon} />
            <span className={styles.outputText}>{playing.playingOn}</span>
          </p>
        </div>
        <div className={styles.words}>
          <LyricsView lyrics={playing.lyrics} />
        </div>
      </div>
      <div className={styles.upNext}>
        <UpNext place={UP_NEXT_PLACES.panel} sourceName={title.sourceName} />
      </div>
    </div>
  )
}
