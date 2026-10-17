import { useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useDesktop } from '@/renderer/desktop/DesktopContext'
import { OpenLinkDialog } from '@/renderer/Shell/OpenLinkDialog'
import { applyReply, NoticeContext, play, playServer } from '@/renderer/Shell/openReply'
import { UpdateNotice } from '@/renderer/Shell/UpdateNotice'
import { HideUpdateProvider, UPDATES_KEY } from '@/renderer/Shell/updateState'
import { useFileDrop } from '@/renderer/Shell/useFileDrop'
import styles from '@/renderer/Shell/Shell.module.scss'
import type { DesktopEvent, DesktopReply } from '@/shared/protocol'

const NOTICE_MS = 6000

// Home and Settings only: a watch route is the quiet page, so the notice waits for Home (Ruling 19).
const UPDATE_PATHS: ReadonlySet<string> = new Set(['/', '/settings'])

const DraggingContext = createContext(false)

export const useDragging = (): boolean => useContext(DraggingContext)

export const Shell = () => {
  const { client, menu } = useDesktop()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [notice, setNotice] = useState<{ message: string } | null>(null)
  const showNotice = useCallback((message: string) => setNotice({ message }), [])
  const [isOpenLinkShown, setIsOpenLinkShown] = useState(false)
  // The newer version main announced, until See what's new or Dismiss; kept for the session only.
  const [update, setUpdate] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const page = useRef<HTMLDivElement>(null)
  const updateLayer = useRef<HTMLDivElement>(null)

  const hideUpdate = useCallback(() => {
    const active = document.activeElement
    const isFocusInside = active !== null && (updateLayer.current?.contains(active) ?? false)
    setUpdate(null)
    if (!isFocusInside) return
    // The focused button goes with the notice; the page's heading keeps the place, as on arrival.
    const heading = page.current === null ? null : page.current.querySelector('h1')
    if (heading !== null) heading.focus()
  }, [])

  // No dialog shows a download ask yet, so the Shell lets one go.
  const openReply = (reply: DesktopReply) =>
    applyReply({ reply, navigate, pathname, showNotice, showDownloadAsk: () => undefined })
  const isDragging = useFileDrop({ client, onReply: openReply })

  const onEvent = useEffectEvent((event: DesktopEvent) => {
    switch (event.type) {
      case 'play':
        return void play({ navigate, pathname, target: event.target })
      case 'playServer':
        return void playServer({ navigate, pathname, target: event.target })
      case 'navigate':
        return void navigate('/settings')
      case 'player':
        return menu.emit(event.action)
      case 'notice':
        return showNotice(event.message)
      case 'openLink':
        return setIsOpenLinkShown(true)
      case 'updateAvailable':
        setUpdate(event.version)
        // Settings reads main's status again, so an open Updates section shows the release too.
        return void queryClient.invalidateQueries({ queryKey: UPDATES_KEY })
      // Nothing shows a download ask or the downloads list yet, so both go unheard.
      case 'downloadAsk':
      case 'downloads':
        return
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
      void client.request({ type: 'ready' })
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
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  return (
    <DraggingContext.Provider value={isDragging}>
      <NoticeContext.Provider value={showNotice}>
        <HideUpdateProvider value={hideUpdate}>
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
          {/* Always mounted: a live region is announced when its text changes, not when it appears. */}
          <output className={styles.notices}>
            {notice !== null && <span className={styles.notice}>{notice.message}</span>}
          </output>
        </HideUpdateProvider>
      </NoticeContext.Provider>
    </DraggingContext.Provider>
  )
}
