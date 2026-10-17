import { createContext, useContext } from 'react'
import { type NavigateFunction, useLocation, useNavigate } from 'react-router-dom'
import type { DesktopReply, PlayTarget, ServerTarget } from '@/shared/protocol'

export const RECENTS_KEY = ['desktop', 'recents'] as const

/** The Shell provides it; a page outside the Shell says nothing. */
export const NoticeContext = createContext<(message: string) => void>(() => undefined)

/** Says something in the Shell's live region, which outlasts the page that said it. */
export const useNotice = (): ((message: string) => void) => useContext(NoticeContext)

const isPlaying = ({ pathname }: { pathname: string }): boolean =>
  pathname.startsWith('/play/') || pathname.startsWith('/server/')

/** A new video replaces the one playing, so Back always returns Home. */
export const play = ({
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
    replace: isPlaying({ pathname }),
  })

/** A server title, by ids; where to start and what follows ride in the route state. */
export const playServer = ({
  navigate,
  pathname,
  target,
}: {
  navigate: NavigateFunction
  pathname: string
  target: ServerTarget
}) =>
  navigate(`/server/${target.serverId}/${target.mediaId}`, {
    state: { at: target.at, next: target.next },
    replace: isPlaying({ pathname }),
  })

export const applyReply = ({
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
    case 'playServer':
      return void playServer({ navigate, pathname, target: reply.target })
    case 'refused':
      return showNotice(reply.message)
    case 'file':
    case 'recents':
    case 'output':
    case 'done':
    case 'servers':
    case 'serverReply':
    case 'serverUnreachable':
    case 'updates':
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
