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
import { useFileDrop } from '@/renderer/Shell/useFileDrop'
import styles from '@/renderer/Shell/Shell.module.scss'
import type { DesktopEvent, DesktopReply } from '@/shared/protocol'

const NOTICE_MS = 6000

const DraggingContext = createContext(false)

export const useDragging = (): boolean => useContext(DraggingContext)

export const Shell = () => {
  const { client, menu } = useDesktop()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [notice, setNotice] = useState<{ message: string } | null>(null)
  const showNotice = useCallback((message: string) => setNotice({ message }), [])
  const [isOpenLinkShown, setIsOpenLinkShown] = useState(false)

  const openReply = (reply: DesktopReply) => applyReply({ reply, navigate, pathname, showNotice })
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

  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  return (
    <DraggingContext.Provider value={isDragging}>
      <NoticeContext.Provider value={showNotice}>
        <Outlet />
        {isOpenLinkShown && <OpenLinkDialog onClose={() => setIsOpenLinkShown(false)} />}
        {/* Always mounted: a live region is announced when its text changes, not when it appears. */}
        <output className={styles.notices}>
          {notice !== null && <span className={styles.notice}>{notice.message}</span>}
        </output>
      </NoticeContext.Provider>
    </DraggingContext.Provider>
  )
}
