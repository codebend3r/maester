import { type NavigateFunction, useLocation, useNavigate } from 'react-router-dom'
import { useNotice } from '@/renderer/stores/notice'
import {
  DESKTOP_REPLIES,
  type DesktopReply,
  type PlayTarget,
  type ServerTarget,
} from '@/shared/protocol'

export const RECENTS_KEY = ['desktop', 'recents'] as const

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
    case DESKTOP_REPLIES.play:
      return void play({ navigate, pathname, target: reply.target })
    case DESKTOP_REPLIES.playServer:
      return void playServer({ navigate, pathname, target: reply.target })
    case DESKTOP_REPLIES.refused:
      return showNotice(reply.message)
    case DESKTOP_REPLIES.file:
    case DESKTOP_REPLIES.recents:
    case DESKTOP_REPLIES.output:
    case DESKTOP_REPLIES.done:
    case DESKTOP_REPLIES.servers:
    case DESKTOP_REPLIES.serverReply:
    case DESKTOP_REPLIES.serverUnreachable:
    case DESKTOP_REPLIES.updates:
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
  const showNotice = useNotice((state) => state.show)
  return (reply) => applyReply({ reply, navigate, pathname, showNotice })
}
