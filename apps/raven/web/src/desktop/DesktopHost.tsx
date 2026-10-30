import { DESKTOP_EVENTS, DESKTOP_REQUESTS, type DesktopEvent } from '@raven/core'
import { useToasts } from '@raven/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSendAccountToken } from '@/desktop/accountToken'
import { DESKTOP_HOST_COPY } from '@/desktop/copy'
import { DownloadDialog } from '@/desktop/DownloadDialog/DownloadDialog'
import { applyDownloadsEvent } from '@/desktop/downloadsApi'
import { OpenLinkDialog } from '@/desktop/OpenLinkDialog/OpenLinkDialog'
import { useOpenReply } from '@/desktop/openReply'
import { DESKTOP_QUERY_KEYS } from '@/desktop/queryKeys'
import { useFollowServerReach, useReturnWhenReached } from '@/desktop/serverReach'
import { useFileDrop } from '@/desktop/useFileDrop'
import { WindowControls } from '@/desktop/WindowControls/WindowControls'
import { WindowEdges } from '@/desktop/WindowEdges/WindowEdges'
import { useDesktop } from '@/stores/desktop'
import { useDownloadAsk } from '@/stores/downloadAsk'
import { handled } from '@/desktop/handled'

/**
 * Raven's part of the page, mounted once over every route: it hears main's events and
 * says the page is ready for them, hands main the page's account, follows whether the server
 * can be reached (going back to the page it left while it could not), takes files dropped on
 * the window, and shows the download and Open Link dialogs.
 */
export const DesktopHost = () => {
  const { client, menu } = useDesktop()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const openReply = useOpenReply()
  const showToast = useToasts((state) => state.show)
  const shownAsk = useDownloadAsk((state) => state.shown)
  const closeAsk = useDownloadAsk((state) => state.close)
  const [isOpenLinkShown, setIsOpenLinkShown] = useState(false)

  useFollowServerReach()
  useReturnWhenReached()
  useSendAccountToken(client)
  useFileDrop({ client, onReply: openReply })

  const onEvent = useEffectEvent((event: DesktopEvent) => {
    switch (event.type) {
      case DESKTOP_EVENTS.play:
      case DESKTOP_EVENTS.downloadAsk:
        return openReply(event)
      case DESKTOP_EVENTS.navigate:
        return handled(Promise.resolve(navigate(event.to)))
      case DESKTOP_EVENTS.player:
        return menu.emit(event.action)
      case DESKTOP_EVENTS.notice:
        return showToast(event.message)
      case DESKTOP_EVENTS.openLink:
        return setIsOpenLinkShown(true)
      case DESKTOP_EVENTS.updateAvailable:
        showToast(DESKTOP_HOST_COPY.newerRelease(event.version))
        // Settings reads main's status again, so an open Updates section shows the release too.
        return void queryClient
          .invalidateQueries({ queryKey: DESKTOP_QUERY_KEYS.updates })
          .catch(() => undefined)
      case DESKTOP_EVENTS.downloads:
        return void applyDownloadsEvent({ queryClient, event }).catch(() => undefined)
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
      client.request({ type: DESKTOP_REQUESTS.ready }).catch(() => undefined)
    }
    return unsubscribe
  }, [client])

  return (
    <>
      <WindowControls />
      <WindowEdges />
      {isOpenLinkShown && <OpenLinkDialog onClose={() => setIsOpenLinkShown(false)} />}
      {shownAsk !== null && (
        <DownloadDialog key={shownAsk.instance} ask={shownAsk.ask} onClose={closeAsk} />
      )}
    </>
  )
}
