import { DESKTOP_REPLIES, DESKTOP_REQUESTS, type ServerId } from '@raven/core'
import { activeServerId, onActiveServerChange, useActiveServer } from '@raven/ui/headless'
import { type DesktopClient, readMain, refusalText } from '@/desktop/client'
import type { OtherServerReads } from '@/lib/otherServers'
import { onAccountLeft } from '@/stores/authSession'
import { useDesktopBridge } from '@/stores/desktop'

/** Why a call through Raven was not made, or a server not read. */
export const DESKTOP_SERVER_ERRORS = {
  notUsed: 'Raven could not switch to that server.',
  notRead: "Raven could not read that server's libraries.",
} as const

/** The server main was last asked to use, and whether it said it does. */
type Asked = { serverId: ServerId | null; isUsed: Promise<boolean> }

const asked: { last: Asked | null } = { last: null }

type AskMainToUseProps = { client: DesktopClient; serverId: ServerId | null }

/**
 * Asks main to use `serverId`. A refusal is not kept, and main has gone home, so the page goes
 * home too unless it switched again meanwhile (a later ask superseded this one).
 */
const askMainToUse = async ({ client, serverId }: AskMainToUseProps): Promise<boolean> => {
  const reply = await client.request({ type: DESKTOP_REQUESTS.useServer, serverId })
  if (reply.type === DESKTOP_REPLIES.done) return true
  console.warn(refusalText({ reply, fallback: DESKTOP_SERVER_ERRORS.notUsed }))
  if (asked.last !== null && asked.last.serverId === serverId) asked.last = null
  if (activeServerId() === serverId) useActiveServer.getState().choose(null)
  return false
}

/**
 * Settles once main uses the server the page has active, asking it once for each change, so no
 * call through main's `/api` relay reaches the last server. Rejects when main will not use it.
 * Outside Raven there is no relay, and it settles at once.
 */
export const mainOnActiveServer = async (): Promise<void> => {
  const desktop = useDesktopBridge.getState().desktop
  if (desktop === null) return
  const serverId = activeServerId()
  const known = asked.last
  const current =
    known !== null && known.serverId === serverId
      ? known
      : { serverId, isUsed: askMainToUse({ client: desktop.client, serverId }) }
  asked.last = current
  if (!(await current.isUsed)) throw new Error(DESKTOP_SERVER_ERRORS.notUsed)
}

// A refusal is logged by the ask, and the next call through the relay asks again.
const tellMain = (): void => {
  mainOnActiveServer().catch(() => undefined)
}

/**
 * Main goes home by itself when the account signed in leaves, so the page goes home with it and
 * forgets what main last said it uses: the next call asks again rather than trust it.
 */
const followMainHome = (): void => {
  asked.last = null
  useActiveServer.getState().choose(null)
}

/**
 * Tells main of every switch as it happens, and of the server the page was left on at once, so
 * what main does on its own (a title, a download) follows the page too, and follows main home on
 * a sign out or another account. Returns what stops it.
 */
export const followActiveServerInMain = (): (() => void) => {
  tellMain()
  const stopFollowingAccount = onAccountLeft(followMainHome)
  const stopTelling = onActiveServerChange(tellMain)
  return () => {
    stopFollowingAccount()
    stopTelling()
  }
}

/** Whether the page's own `/api` is main's relay to the server in use: inside Raven. */
export const isRelayedByMain = (): boolean => useDesktopBridge.getState().desktop !== null

/**
 * The other servers as main reads them for the page, which may call no other origin: a new
 * server's id from its open health (null when it does not answer), and another of the account's
 * servers' libraries, named by its id alone.
 */
export const desktopReadsOf = (client: DesktopClient): OtherServerReads => ({
  healthIdAt: async (origin) => {
    const reply = await client.request({ type: DESKTOP_REQUESTS.checkServer, origin })
    return reply.type === DESKTOP_REPLIES.server ? { serverId: reply.serverId } : null
  },
  librariesOf: ({ serverId }) => ({
    listLibraries: async () => {
      const reply = await readMain({
        client,
        request: { type: DESKTOP_REQUESTS.serverLibraries, serverId },
        fallback: DESKTOP_SERVER_ERRORS.notRead,
      })
      return reply.libraries
    },
  }),
})
