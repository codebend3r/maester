import { DESKTOP_REPLIES, type DesktopReply } from '@raven/core'
import { useToasts } from '@raven/ui'
import { type NavigateFunction, useLocation, useNavigate } from 'react-router-dom'
import { isPlaying, playPathOf } from '@/desktop/paths'
import { useDownloadAsk } from '@/stores/downloadAsk'
import { handled } from '@/desktop/handled'

/**
 * What to do with main's answer to opening something: play a file (replacing a video already
 * on screen, so Back leaves the player), show a page, ask about a download, or say why not.
 */
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
}): void => {
  switch (reply.type) {
    case DESKTOP_REPLIES.play:
      return handled(
        Promise.resolve(
          navigate(playPathOf(reply.target.fileId), {
            state: { queue: reply.target.queue },
            replace: isPlaying(pathname),
          }),
        ),
      )
    case DESKTOP_REPLIES.navigate:
      return handled(Promise.resolve(navigate(reply.to)))
    case DESKTOP_REPLIES.downloadAsk:
      return useDownloadAsk.getState().show(reply.ask)
    case DESKTOP_REPLIES.refused:
      return showNotice(reply.message)
    case DESKTOP_REPLIES.file:
    case DESKTOP_REPLIES.recents:
    case DESKTOP_REPLIES.output:
    case DESKTOP_REPLIES.done:
    case DESKTOP_REPLIES.title:
    case DESKTOP_REPLIES.titleRefused:
    case DESKTOP_REPLIES.updates:
    case DESKTOP_REPLIES.downloads:
    case DESKTOP_REPLIES.space:
      return
    default: {
      const unreachable: never = reply
      return unreachable
    }
  }
}

/** `applyReply` bound to this page's router and toasts. */
export const useOpenReply = (): ((reply: DesktopReply) => void) => {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const showNotice = useToasts((state) => state.show)
  return (reply) => applyReply({ reply, navigate, pathname, showNotice })
}
