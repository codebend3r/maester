import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useDesktop } from '@/renderer/stores/desktop'
import {
  type AccountView,
  DESKTOP_REPLIES,
  DESKTOP_REQUESTS,
  type DesktopReply,
  type DesktopRequest,
} from '@/shared/protocol'

const NO_ACCOUNT = 'raven player could not read this server account.'
const UNREACHED = 'raven player could not reach its sign-in. Try again.'

/** One server's account as main shows it; Shell replaces it with the one main sends when it changed. */
export const accountKey = (serverId: string) => ['desktop', 'account', serverId] as const

/** A server's account: its state, who is signed in, and where the sign-in goes. Never a token. */
export const useAccount = (serverId: string): UseQueryResult<AccountView> => {
  const { client } = useDesktop()
  return useQuery({
    queryKey: accountKey(serverId),
    queryFn: async () => {
      const reply = await client.request({ type: DESKTOP_REQUESTS.readAccount, serverId })
      if (reply.type === DESKTOP_REPLIES.account) return reply.account
      throw new Error(reply.type === DESKTOP_REPLIES.refused ? reply.message : NO_ACCOUNT)
    },
    retry: false,
  })
}

export const ACCOUNT_ANSWERS = { done: 'done', refused: 'refused' } as const

/** What a change to an account came to: main did it, or said why not. */
type AccountAnswer =
  | { kind: typeof ACCOUNT_ANSWERS.done }
  | { kind: typeof ACCOUNT_ANSWERS.refused; message: string }

const DONE: AccountAnswer = { kind: ACCOUNT_ANSWERS.done }

const refusedWith = (message: string): AccountAnswer => ({
  kind: ACCOUNT_ANSWERS.refused,
  message,
})

type AccountRequest = Extract<
  DesktopRequest,
  {
    type:
      | typeof DESKTOP_REQUESTS.refreshAccount
      | typeof DESKTOP_REQUESTS.signIn
      | typeof DESKTOP_REQUESTS.signOut
      | typeof DESKTOP_REQUESTS.openAccountPage
  }
>

type InputOf<Type extends AccountRequest['type']> = Omit<
  Extract<AccountRequest, { type: Type }>,
  'type'
>

type SignInInput = InputOf<typeof DESKTOP_REQUESTS.signIn>

type OpenPageInput = InputOf<typeof DESKTOP_REQUESTS.openAccountPage>

type AccountActions = {
  signIn: (input: SignInInput) => Promise<AccountAnswer>
  signOut: (serverId: string) => Promise<AccountAnswer>
  /** Main reads the server again: Check again, for an account waiting on approval. */
  refresh: (serverId: string) => Promise<AccountAnswer>
  /** Create account or Forgot password, in the person's browser. */
  openAccountPage: (input: OpenPageInput) => Promise<AccountAnswer>
}

/** The changes a person makes to an account. An account main answers with replaces the query's. */
export const useAccountActions = (): AccountActions => {
  const { client } = useDesktop()
  const queryClient = useQueryClient()

  const answerOf = ({
    request,
    reply,
  }: {
    request: AccountRequest
    reply: DesktopReply | null
  }): AccountAnswer => {
    if (reply === null) return refusedWith(UNREACHED)
    switch (reply.type) {
      case DESKTOP_REPLIES.account:
        queryClient.setQueryData(accountKey(reply.account.serverId), reply.account)
        return DONE
      case DESKTOP_REPLIES.done:
        // Only opening a page answers with nothing to show; the rest must answer with the account.
        return request.type === DESKTOP_REQUESTS.openAccountPage ? DONE : refusedWith(UNREACHED)
      case DESKTOP_REPLIES.refused:
        return refusedWith(reply.message)
      case DESKTOP_REPLIES.play:
      case DESKTOP_REPLIES.playServer:
      case DESKTOP_REPLIES.file:
      case DESKTOP_REPLIES.recents:
      case DESKTOP_REPLIES.output:
      case DESKTOP_REPLIES.serverReply:
      case DESKTOP_REPLIES.serverUnreachable:
      case DESKTOP_REPLIES.servers:
      case DESKTOP_REPLIES.updates:
      case DESKTOP_REPLIES.downloadAsk:
      case DESKTOP_REPLIES.downloads:
      case DESKTOP_REPLIES.space:
        return refusedWith(UNREACHED)
      default: {
        const unreachable: never = reply
        return unreachable
      }
    }
  }

  const send = async (request: AccountRequest): Promise<AccountAnswer> =>
    answerOf({ request, reply: await client.request(request).catch(() => null) })

  return {
    signIn: (input) => send({ type: DESKTOP_REQUESTS.signIn, ...input }),
    signOut: (serverId) => send({ type: DESKTOP_REQUESTS.signOut, serverId }),
    refresh: (serverId) => send({ type: DESKTOP_REQUESTS.refreshAccount, serverId }),
    openAccountPage: (input) => send({ type: DESKTOP_REQUESTS.openAccountPage, ...input }),
  }
}
