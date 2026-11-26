import type { Track } from '@raven/core'
import { isPlayingOf, playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { PLAYER_COPY, TRANSPORTS, factsLineOf, WREN_ICONS } from '@raven/wren'
import { useNavigate } from 'react-router-dom'
import { SCRUBBERS, Scrubber } from '@/player/Scrubber/Scrubber'
import { Transport } from '@/player/Transport/Transport'
import { useNowPlaying } from '@/player/useNowPlaying'
import { useQuality } from '@/player/useQuality'
import { Volume } from '@/player/Volume/Volume'
import { WREN_ROUTES } from '@/routes'
import { SIZES } from '@/theme/tokens'
import { IconButton } from '@/ui/IconButton/IconButton'
import { PlayingSummary } from '@/ui/PlayingSummary/PlayingSummary'
import styles from '@/shell/PlayerBar/PlayerBar.module.scss'

type PlayingBarProps = { track: Track }

function PlayingBar({ track }: PlayingBarProps) {
  const navigate = useNavigate()
  const { cover, artists, length, error } = useNowPlaying({ track })
  const quality = useQuality({ track })
  const isPlaying = useAudioQueue(isPlayingOf)
  const openNowPlaying = () => navigate(WREN_ROUTES.nowPlaying)
  return (
    <section className={styles.bar}>
      <PlayingSummary
        artSize={SIZES.barArt}
        artists={artists}
        className={styles.nowPlaying}
        cover={cover}
        error={error}
        isPlaying={isPlaying}
        line={factsLineOf([artists, track.album.title])}
        onOpen={openNowPlaying}
        quality={quality}
        title={track.title}
      />
      <div className={styles.centre}>
        <Transport kind={TRANSPORTS.bar} />
        <Scrubber kind={SCRUBBERS.bar} length={length} />
      </div>
      <div className={styles.end}>
        <IconButton icon={WREN_ICONS.lyrics} label={PLAYER_COPY.lyrics} onPress={openNowPlaying} />
        <IconButton icon={WREN_ICONS.upNext} label={PLAYER_COPY.upNext} onPress={openNowPlaying} />
        <span className={styles.volume}>
          <Volume />
        </span>
      </div>
    </section>
  )
}

/**
 * The wide layout's player bar along the foot of every page while a track is queued: what
 * plays and its format as chips, Previous, Play or Pause and Next over the scrubber in the
 * middle, then Lyrics and Up next, which open Now Playing, and the volume behind its speaker.
 */
export function PlayerBar() {
  const track = useAudioQueue(playingTrackOf)
  return track !== null && <PlayingBar track={track} />
}
