import { AudioHost } from '@raven/ui'
import type { ComponentType } from 'react'
import { Outlet } from 'react-router-dom'
import { useReprobe } from '@/components/MediaOriginProbe/MediaOriginProbe'
import { NowPlayingBar, useIsBarShown } from '@/components/NowPlayingBar/NowPlayingBar'
import { DesktopAudioHost } from '@/desktop/audio/DesktopAudioHost'
import { api } from '@/lib/api'
import { useIsDesktop } from '@/stores/desktop'
import styles from '@/components/PlayerLayer/PlayerLayer.module.scss'

/** Where the music plays: Raven's own engine, or the browser's. */
const PLAYER_HOSTS = {
  desktop: 'desktop',
  browser: 'browser',
} as const

type PlayerHost = (typeof PLAYER_HOSTS)[keyof typeof PLAYER_HOSTS]

type AudioHostProps = Parameters<typeof AudioHost>[0]

const AUDIO_HOSTS = {
  [PLAYER_HOSTS.desktop]: DesktopAudioHost,
  [PLAYER_HOSTS.browser]: AudioHost,
} as const satisfies Record<PlayerHost, ComponentType<AudioHostProps>>

/**
 * Music under both shells, raven's and the music mode's: the engine once,
 * and the now-playing bar along the foot of the screen while a track
 * plays. The shell is the outlet, so going from one mode to the other
 * swaps the shell and leaves the engine, and what it plays, where it is.
 */
export const PlayerLayer = () => {
  const isDesktop = useIsDesktop()
  const reprobe = useReprobe()
  const isBarShown = useIsBarShown()
  const Audio = AUDIO_HOSTS[isDesktop ? PLAYER_HOSTS.desktop : PLAYER_HOSTS.browser]
  return (
    <div className={isBarShown ? `${styles.layer} ${styles.withBar}` : styles.layer}>
      <div className={styles.shell}>
        <Outlet />
      </div>
      <div className={styles.player}>
        <Audio api={api} reprobe={reprobe} />
        <NowPlayingBar />
      </div>
    </div>
  )
}
