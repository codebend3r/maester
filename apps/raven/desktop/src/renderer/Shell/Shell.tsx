import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { applyDownloadsEvent } from '@/renderer/desktop/downloadsApi'
import { accountKey } from '@/renderer/desktop/accountApi'
import { DownloadDialog } from '@/renderer/Shell/DownloadDialog'
import { OpenLinkDialog } from '@/renderer/Shell/OpenLinkDialog'
import { applyReply, play, playServer } from '@/renderer/Shell/openReply'
import { UpdateNotice } from '@/renderer/Shell/UpdateNotice'
import { UPDATES_KEY } from '@/renderer/Shell/updateState'
import { useFileDrop } from '@/renderer/Shell/useFileDrop'
import styles from '@/renderer/Shell/Shell.module.scss'
import { useDesktop } from '@/renderer/stores/desktop'
import { useDownloadAsk } from '@/renderer/stores/downloadAsk'
import { useNotice } from '@/renderer/stores/notice'
import { useUpdateNotice } from '@/renderer/stores/updateNotice'
import {
  DESKTOP_EVENTS,
  DESKTOP_REQUESTS,
  type DesktopEvent,
  type DesktopReply,
} from '@/shared/protocol'

const NOTICE_MS = 6000

// Home and Settings only: a watch route is the quiet page, so the notice waits for Home (Ruling 19).
const UPDATE_PATHS: ReadonlySet<string> = new Set(['/', '/settings'])

export const Shell = () => {
  const { client, menu } = useDesktop()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const notice = useNotice((state) => state.notice)
  const showNotice = useNotice((state) => state.show)
  const clearNotice = useNotice((state) => state.clear)
  const shownAsk = useDownloadAsk((state) => state.shown)
  const showDownloadAsk = useDownloadAsk((state) => state.show)
  const closeDownloadAsk = useDownloadAsk((state) => state.close)
  const [isOpenLinkShown, setIsOpenLinkShown] = useState(false)
  const update = useUpdateNotice((state) => state.version)
  const announceUpdate = useUpdateNotice((state) => state.announce)
  const hideUpdate = useUpdateNotice((state) => state.hide)
  const queryClient = useQueryClient()
  const page = useRef<HTMLDivElement>(null)
  const updateLayer = useRef<HTMLDivElement>(null)

  // Whoever hides the update notice, Settings included, the focused button goes with it and the
  // page's heading keeps the place, as on arrival. The store calls this before React redraws, so
  // the notice is still on the page to ask about.
  useEffect(
    () =>
      useUpdateNotice.subscribe((state, previous) => {
        if (state.version !== null || previous.version === null) return
        const active = document.activeElement
        if (active === null || !(updateLayer.current?.contains(active) ?? false)) return
        const heading = page.current === null ? null : page.current.querySelector('h1')
        if (heading !== null) heading.focus()
      }),
    [],
  )

  // Both notices end with the Shell that shows them, so a later one starts quiet. Declared
  // after the focus subscription, whose cleanup runs first, so leaving moves no focus.
  useEffect(
    () => () => {
      clearNotice()
      hideUpdate()
    },
    [clearNotice, hideUpdate],
  )

  const openReply = (reply: DesktopReply) =>
    applyReply({ reply, navigate, pathname, showNotice, showDownloadAsk })
  useFileDrop({ client, onReply: openReply })

  const onEvent = useEffectEvent((event: DesktopEvent) => {
    switch (event.type) {
      case DESKTOP_EVENTS.play:
        return void play({ navigate, pathname, target: event.target })
      case DESKTOP_EVENTS.playServer:
        return void playServer({ navigate, pathname, target: event.target })
      case DESKTOP_EVENTS.navigate:
        return void navigate('/settings')
      case DESKTOP_EVENTS.player:
        return menu.emit(event.action)
      case DESKTOP_EVENTS.notice:
        return showNotice(event.message)
      case DESKTOP_EVENTS.openLink:
        return setIsOpenLinkShown(true)
      case DESKTOP_EVENTS.updateAvailable:
        announceUpdate(event.version)
        // Settings reads main's status again, so an open Updates section shows the release too.
        return void queryClient.invalidateQueries({ queryKey: UPDATES_KEY })
      case DESKTOP_EVENTS.downloadAsk:
        return showDownloadAsk(event.ask)
      case DESKTOP_EVENTS.downloads:
        return void applyDownloadsEvent({ queryClient, event })
      case DESKTOP_EVENTS.account:
        return void queryClient.setQueryData(accountKey(event.account.serverId), event.account)
      default: {
        const unreachable: never = event
        return unreachable
      }
    }
  })

  // A ref survives StrictMode's second run of the effect; main reads every `ready` as a new page.
  const hasSaidReady = useRef(false)

  useEffect(() => {
    const unsubscribe = client.subscribe((event) => onEvent(event))
    if (!hasSaidReady.current) {
      hasSaidReady.current = true
      // Main holds what it was asked to open until the page is listening.
      void client.request({ type: DESKTOP_REQUESTS.ready })
    }
    return unsubscribe
  }, [client])

  const isUpdateShown = update !== null && UPDATE_PATHS.has(pathname)

  // The sticky notice covers the window's foot, so the page scrolls a control Tab reaches
  // clear of it (WCAG 2.4.11), for as long as the notice stays and at whatever height it wraps to.
  useEffect(() => {
    const layer = updateLayer.current
    if (!isUpdateShown || layer === null) return
    const root = document.documentElement
    const observer = new ResizeObserver(() => {
      root.style.scrollPaddingBlockEnd = `${layer.getBoundingClientRect().height}px`
    })
    observer.observe(layer)
    return () => {
      observer.disconnect()
      root.style.scrollPaddingBlockEnd = ''
    }
  }, [isUpdateShown])

  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(clearNotice, NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice, clearNotice])

  return (
    <>
      <div className={styles.shell}>
        <div ref={page} className={styles.page}>
          <Outlet />
        </div>
        {isUpdateShown && update !== null && (
          <div ref={updateLayer} className={styles.updates}>
            <UpdateNotice className={styles.update} version={update} onClose={hideUpdate} />
          </div>
        )}
      </div>
      {isOpenLinkShown && <OpenLinkDialog onClose={() => setIsOpenLinkShown(false)} />}
      {shownAsk !== null && (
        <DownloadDialog key={shownAsk.instance} ask={shownAsk.ask} onClose={closeDownloadAsk} />
      )}
      {/* Always mounted: a live region is announced when its text changes, not when it appears. */}
      <output className={styles.notices}>
        {notice !== null && <span className={styles.notice}>{notice.message}</span>}
      </output>
    </>
  )
}
