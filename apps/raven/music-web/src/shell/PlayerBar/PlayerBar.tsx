import type { Track } from '@raven/core'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { PLAYER_COPY, TRANSPORTS, factsLineOf } from '@raven/wren'
import { useNavigate } from 'react-router-dom'
import { SCRUBBERS, Scrubber } from '@/player/Scrubber/Scrubber'
import { Transport } from '@/player/Transport/Transport'
import { useNowPlaying } from '@/player/useNowPlaying'
import { Volume } from '@/player/Volume/Volume'
import { WREN_ROUTES } from '@/routes'
import { RADII, SIZES } from '@/theme/tokens'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import { IconButton } from '@/ui/IconButton/IconButton'
import { Pressable } from '@/ui/Pressable/Pressable'
import { ICONS } from '@/ui/WrenIcon/icons'
import styles from '@/shell/PlayerBar/PlayerBar.module.scss'

type PlayingBarProps = { track: Track }

function PlayingBar({ track }: PlayingBarProps) {
  const navigate = useNavigate()
  const { cover, artists, length, error } = useNowPlaying({ track })
  const openNowPlaying = () => navigate(WREN_ROUTES.nowPlaying)
  return (
    <section className={styles.bar}>
      <Pressable
        className={styles.nowPlaying}
        label={PLAYER_COPY.open({ title: track.title, artists })}
        onPress={openNowPlaying}
      >
        <AlbumArt cover={cover} radius={RADII.thumb} size={SIZES.barArt} />
        <span className={styles.text}>
          <span className={styles.title}>{track.title}</span>
          <span className={error === null ? styles.line : styles.error}>
            {error ?? factsLineOf([artists, track.album.title])}
          </span>
        </span>
      </Pressable>
      <div className={styles.centre}>
        <Transport kind={TRANSPORTS.bar} />
        <Scrubber kind={SCRUBBERS.bar} length={length} />
      </div>
      <div className={styles.end}>
        <IconButton icon={ICONS.lyrics} label={PLAYER_COPY.lyrics} onPress={openNowPlaying} />
        <IconButton icon={ICONS.upNext} label={PLAYER_COPY.upNext} onPress={openNowPlaying} />
        <span className={styles.volume}>
          <Volume />
        </span>
      </div>
    </section>
  )
}

/**
 * The wide layout's player bar along the foot of every page while a track is queued: what
 * plays, the transport and the scrubber in the middle, then Lyrics and Up next, which open Now
 * Playing, and the volume.
 */
export function PlayerBar() {
  const track = useAudioQueue(playingTrackOf)
  return track !== null && <PlayingBar track={track} />
}
