import { AudioHost } from '@raven/ui'
import { classNames, hasPlayingTrackOf, useAudioQueue } from '@raven/ui/headless'
import type { ComponentType, ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { ACCESS_KINDS, useAccess } from '@/lib/access'
import { api } from '@/lib/api'
import { deviceSpotOf, useKeepSongProgress } from '@/music/songProgress'
import { CHROMES, type Chrome, useChrome, useShownPath } from '@/shell/chrome'
import { NowPlayingBar } from '@/shell/NowPlayingBar/NowPlayingBar'
import { TABS } from '@/shell/places'
import { PlayerBar } from '@/shell/PlayerBar/PlayerBar'
import { Sidebar } from '@/shell/Sidebar/Sidebar'
import { usePlayPauseKey } from '@/shell/usePlayPauseKey'
import { useScrollReset } from '@/shell/useScrollReset'
import { FORM_FACTORS, type FormFactor, useFormFactor } from '@/theme/formFactor'
import { TabBar } from '@/ui/TabBar/TabBar'
import { ToastHost } from '@/ui/Toast/Toast'
import styles from '@/shell/Shell.module.scss'

/** Wren's four tabs, Home, Library, Search and Settings, on the kit's bar. */
function Tabs() {
  const pathname = useShownPath()
  return (
    <TabBar
      items={TABS.map(({ label, icon, path }) => ({
        key: path,
        label,
        icon,
        href: path,
        isActive: pathname === path,
      }))}
    />
  )
}

type FrameProps = {
  /** What surrounds the page showing; bare until the listener is let in. */
  chrome: Chrome
  children: ReactNode
}

/*
 * The narrow layout, the apps' phone's: the page over the tab bar on a tab, with the mini player
 * floating above it while a track is queued, and at the foot of any other page.
 */
function PhoneFrame({ chrome, children }: FrameProps) {
  const hasChrome = chrome !== CHROMES.bare
  const isTabbed = chrome === CHROMES.tabs
  const hasPlayer = useAudioQueue((store) => hasChrome && hasPlayingTrackOf(store))
  return (
    <div
      className={classNames([styles.phone, hasPlayer && styles.queued, isTabbed && styles.tabbed])}
    >
      <div className={styles.page}>{children}</div>
      <footer className={classNames([styles.foot, !isTabbed && styles.clearsHome])}>
        <ToastHost />
        {hasChrome && <NowPlayingBar />}
        {isTabbed && <Tabs />}
      </footer>
    </div>
  )
}

/*
 * The wide layout, the apps' tablet's: the sidebar beside the page and the player bar under
 * both, neither on sign-in or Now Playing.
 */
function WideFrame({ chrome, children }: FrameProps) {
  const hasChrome = chrome !== CHROMES.bare
  const isPlaying = useAudioQueue(hasPlayingTrackOf)
  return (
    <div className={classNames([styles.wide, hasChrome && isPlaying && styles.playing])}>
      {hasChrome && <Sidebar />}
      <div className={styles.page}>{children}</div>
      <footer className={styles.foot}>
        <ToastHost />
        {hasChrome && <PlayerBar />}
      </footer>
    </div>
  )
}

/** Keeps each song's progress in this browser, apart from the shell, which redraws on no tick. */
function KeepSongProgress() {
  useKeepSongProgress()
  return null
}

const FRAMES = {
  [FORM_FACTORS.phone]: PhoneFrame,
  [FORM_FACTORS.tablet]: WideFrame,
} as const satisfies Record<FormFactor, ComponentType<FrameProps>>

/**
 * What frames every route, as the apps' `WrenRoot` does. Music plays from here, above the
 * routes, so leaving a page stops nothing, and each song's progress is kept in this browser; the
 * toast floats over whichever bars show. Until the listener is let in there is no chrome and no
 * player, so nothing asks raven for what it would refuse.
 */
export function Shell() {
  const isOpen = useAccess() === ACCESS_KINDS.open
  const chrome = useChrome()
  const Frame = FRAMES[useFormFactor()]
  useScrollReset()
  usePlayPauseKey()
  return (
    <>
      {isOpen && (
        <>
          <AudioHost api={api} deviceSpotOf={deviceSpotOf} />
          <KeepSongProgress />
        </>
      )}
      <Frame chrome={isOpen ? chrome : CHROMES.bare}>
        <Outlet />
      </Frame>
    </>
  )
}
