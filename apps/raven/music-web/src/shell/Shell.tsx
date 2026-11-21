import { AudioHost } from '@raven/ui'
import { classNames, hasPlayingTrackOf, useAudioQueue } from '@raven/ui/headless'
import type { ComponentType, ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { NowPlayingBar } from '@/components/NowPlayingBar/NowPlayingBar'
import { ACCESS_KINDS, useAccess } from '@/lib/access'
import { api } from '@/lib/api'
import { CHROMES, type Chrome, useChrome } from '@/shell/chrome'
import { TABS } from '@/shell/places'
import { PlayerBar } from '@/shell/PlayerBar/PlayerBar'
import { Sidebar } from '@/shell/Sidebar/Sidebar'
import { useScrollReset } from '@/shell/useScrollReset'
import { FORM_FACTORS, type FormFactor, useFormFactor } from '@/theme/formFactor'
import { TabBar } from '@/ui/TabBar/TabBar'
import { ToastHost } from '@/ui/Toast/Toast'
import styles from '@/shell/Shell.module.scss'

/** Wren's four tabs, Home, Library, Search and Settings, on the kit's bar. */
function Tabs() {
  const { pathname } = useLocation()
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
  const hasPlayer = useAudioQueue((store) => chrome !== CHROMES.bare && hasPlayingTrackOf(store))
  return (
    <div
      className={classNames([
        styles.phone,
        hasPlayer && styles.queued,
        chrome === CHROMES.tabs && styles.tabbed,
      ])}
    >
      <div className={styles.page}>{children}</div>
      <footer className={classNames([styles.foot, chrome !== CHROMES.tabs && styles.clearsHome])}>
        <ToastHost />
        {chrome !== CHROMES.bare && <NowPlayingBar />}
        {chrome === CHROMES.tabs && <Tabs />}
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

const FRAMES = {
  [FORM_FACTORS.phone]: PhoneFrame,
  [FORM_FACTORS.tablet]: WideFrame,
} as const satisfies Record<FormFactor, ComponentType<FrameProps>>

/**
 * What frames every route, as the apps' `WrenRoot` does. Music plays from here, above the
 * routes, so leaving a page stops nothing; the toast floats over whichever bars show. Until the
 * listener is let in there is no chrome and no player, so nothing asks raven for what it would
 * refuse.
 */
export function Shell() {
  const isOpen = useAccess() === ACCESS_KINDS.open
  const chrome = useChrome()
  const Frame = FRAMES[useFormFactor()]
  useScrollReset()
  return (
    <>
      {isOpen && <AudioHost api={api} />}
      <Frame chrome={isOpen ? chrome : CHROMES.bare}>
        <Outlet />
      </Frame>
    </>
  )
}
