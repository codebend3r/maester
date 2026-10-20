import { fakeClient } from '@/renderer/test/render'
import {
  ACCOUNT_STATES,
  type AccountView,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopReply,
  type DesktopRequest,
  type SERVER_METHODS,
  type ServerView,
} from '@/shared/protocol'

export const S = '33333333-3333-4333-8333-333333333333'

export const VHAGAR: ServerView = { serverId: S, origin: 'https://raven.example', name: 'Vhagar' }

const DONE_REPLY: DesktopReply = { type: DESKTOP_REPLIES.done }

/** A server whose accounts are off, which every server page test starts from. */
export const OFF_ACCOUNT: AccountView = {
  serverId: S,
  state: ACCOUNT_STATES.off,
  email: null,
  isRemembered: true,
  signInHost: null,
}

/** A server's answer: a status and a JSON body, as main relays it. */
export const reply = ({
  status = 200,
  body,
}: {
  status?: number
  body: unknown
}): DesktopReply => ({
  type: 'serverReply',
  status,
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

/** `METHOD /path`, as the table names a call. */
export type CallKey = `${(typeof SERVER_METHODS)[keyof typeof SERVER_METHODS]} ${string}`

/** An answer the test may hold back: a reply, or a promise of one it settles later. */
export type CallAnswer = DesktopReply | Promise<DesktopReply>

/** A reply the test settles when it chooses. */
export const heldReply = () => {
  const settle: { resolve: (reply: DesktopReply) => void } = { resolve: () => {} }
  const promise = new Promise<DesktopReply>((resolve) => {
    settle.resolve = resolve
  })
  return { promise, resolve: (answer: DesktopReply) => settle.resolve(answer) }
}

/**
 * A client that knows Vhagar and answers each server call from `calls`: a list is
 * answered in order, its last answer repeating; a call the table lacks answers 404.
 * `replies` answers other requests by type; anything else is done. `account` is what
 * `readAccount` answers (done when none), read at each request so a test can change it
 * mid-play.
 */
export const serverClient = ({
  calls,
  servers = [VHAGAR],
  replies = {},
  account = null,
}: {
  calls: Partial<Record<CallKey, CallAnswer | CallAnswer[]>>
  servers?: ServerView[]
  replies?: Partial<Record<DesktopRequest['type'], DesktopReply>>
  account?: { current: AccountView } | null
}) => {
  const answered = new Map<string, number>()
  const answer = (
    request: Extract<DesktopRequest, { type: typeof DESKTOP_REQUESTS.serverCall }>,
  ): CallAnswer => {
    const key = `${request.method} ${request.path}`
    const entry = Object.entries(calls).find(([name]) => name === key)?.[1] ?? null
    if (entry === null) return reply({ status: 404, body: { message: 'Not found' } })
    const answers = Array.isArray(entry) ? entry : [entry]
    const count = answered.get(key) ?? 0
    answered.set(key, count + 1)
    return answers[Math.min(count, answers.length - 1)] ?? reply({ status: 500, body: {} })
  }
  return fakeClient({
    request: async (request) => {
      switch (request.type) {
        case DESKTOP_REQUESTS.listServers:
          return { type: 'servers', servers }
        case DESKTOP_REQUESTS.listRecents:
          return { type: 'recents', recents: [] }
        case DESKTOP_REQUESTS.serverCall:
          return answer(request)
        case DESKTOP_REQUESTS.readAccount:
          if (replies[request.type] !== undefined) return replies[request.type] ?? DONE_REPLY
          return account === null
            ? DONE_REPLY
            : { type: DESKTOP_REPLIES.account, account: account.current }
        default:
          return replies[request.type] ?? { type: DESKTOP_REPLIES.done }
      }
    },
  })
}

/** The server calls the page sent, as `METHOD /path`. */
export const serverCallsOf = (client: ReturnType<typeof fakeClient>) =>
  client.request.mock.calls
    .map(([request]) => request)
    .flatMap((request) => (request.type === DESKTOP_REQUESTS.serverCall ? [request] : []))

export const callNamesOf = (client: ReturnType<typeof fakeClient>): string[] =>
  serverCallsOf(client).map((request) => `${request.method} ${request.path}`)

export const sentOfType = ({
  client,
  type,
}: {
  client: ReturnType<typeof fakeClient>
  type: DesktopRequest['type']
}): DesktopRequest[] =>
  client.request.mock.calls.map(([request]) => request).filter((request) => request.type === type)
