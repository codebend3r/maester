import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import { type NavigateFunction, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useDesktop } from '@/renderer/desktop/DesktopContext'
import { useFileDrop } from '@/renderer/Shell/useFileDrop'
import styles from '@/renderer/Shell/Shell.module.scss'
import type { DesktopEvent, DesktopReply, PlayTarget } from '@/shared/protocol'

export const RECENTS_KEY = ['desktop', 'recents'] as const

const NOTICE_MS = 6000

const DraggingContext = createContext(false)
const NoticeContext = createContext<(message: string) => void>(() => undefined)

export const useDragging = (): boolean => useContext(DraggingContext)

/** A new video replaces the one playing, so Back always returns Home. */
const play = ({
  navigate,
  pathname,
  target,
}: {
  navigate: NavigateFunction
  pathname: string
  target: PlayTarget
}) =>
  navigate(`/play/${target.fileId}`, {
    state: { queue: target.queue },
    replace: pathname.startsWith('/play/'),
  })

const applyReply = ({
  reply,
  navigate,
  pathname,
  showNotice,
}: {
  reply: DesktopReply
  navigate: NavigateFunction
  pathname: string
  showNotice: (message: string) => void
}) => {
  switch (reply.type) {
    case 'play':
      return void play({ navigate, pathname, target: reply.target })
    case 'refused':
      return showNotice(reply.message)
    case 'file':
    case 'recents':
    case 'done':
      return
    default: {
      const unreachable: never = reply
      return unreachable
    }
  }
}

/** What to do with main's answer to opening something: play it, or say why not. */
export const useOpenReply = (): ((reply: DesktopReply) => void) => {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const showNotice = useContext(NoticeContext)
  return (reply) => applyReply({ reply, navigate, pathname, showNotice })
}

export const Shell = () => {
  const { client, menu } = useDesktop()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [notice, setNotice] = useState<{ message: string } | null>(null)
  const showNotice = useCallback((message: string) => setNotice({ message }), [])

  const openReply = (reply: DesktopReply) => applyReply({ reply, navigate, pathname, showNotice })
  const isDragging = useFileDrop({ client, onReply: openReply })

  const onEvent = useEffectEvent((event: DesktopEvent) => {
    switch (event.type) {
      case 'play':
        return void play({ navigate, pathname, target: event.target })
      case 'navigate':
        return void navigate('/settings')
      case 'player':
        return menu.emit(event.action)
      case 'notice':
        return showNotice(event.message)
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
        {/* Always mounted: a live region is announced when its text changes, not when it appears. */}
        <output className={styles.notice}>{notice?.message ?? ''}</output>
      </NoticeContext.Provider>
    </DraggingContext.Provider>
  )
}
