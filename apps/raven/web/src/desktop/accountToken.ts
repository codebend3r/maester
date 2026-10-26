import { DESKTOP_REPLIES, DESKTOP_REQUESTS } from '@raven/core'
import { useEffect } from 'react'
import type { DesktopClient } from '@/desktop/client'
import { AUTH_SESSION_STATUSES, type AuthSessionState, useAuthSession } from '@/stores/authSession'

type SessionView = Pick<AuthSessionState, 'status' | 'session'>

type IsSameForMainProps = { before: SessionView; after: SessionView }

/** Whether two reads of the session hand main the same thing; a booting one hands it nothing. */
const isSameForMain = ({ before, after }: IsSameForMainProps) =>
  before.status === after.status &&
  (before.session?.accessToken ?? null) === (after.session?.accessToken ?? null) &&
  (before.session?.userId ?? null) === (after.session?.userId ?? null)

/**
 * Hands main the page's session whenever it changes, and null once it signs out, so main's own
 * calls (mpv's titles, downloads, the plays it syncs) go as the account the page shows. Nothing
 * is sent while the session is still being read: a null then would sign main out of an account
 * the page is about to report again.
 */
export const useSendAccountToken = (client: DesktopClient): void => {
  useEffect(() => {
    const send = async (session: SessionView['session']) => {
      const reply = await client.request({ type: DESKTOP_REQUESTS.accountToken, session })
      if (reply.type === DESKTOP_REPLIES.refused) {
        console.warn(`Raven refused the page's account: ${reply.message}`)
      }
    }
    const sendWhenReady = (state: SessionView) => {
      if (state.status !== AUTH_SESSION_STATUSES.ready) return
      send(state.session).catch(() => undefined)
    }
    sendWhenReady(useAuthSession.getState())
    return useAuthSession.subscribe((after, before) => {
      if (!isSameForMain({ before, after })) sendWhenReady(after)
    })
  }, [client])
}
