import type { Transport } from '@/apiClient/transport'
import {
  type Account,
  AUTH_METHODS,
  AUTH_PARAMS,
  AUTH_PATHS,
  type AuthConfig,
  isAccount,
  isAccountList,
  isAuthConfig,
  isMediaTicket,
  type MediaTicket,
  type MemberStatusChange,
} from '@/contract'
import { toQueryString } from '@/query'

type ListMembersProps = { pageSize?: number; pageOffset?: number }

type SetMemberStatusProps = {
  id: string
  change: MemberStatusChange
}

type GetAccountMediaTicketProps = { id: number }

/** The account's own routes: its configuration, who it is, the members, and the ticket a title plays by. */
export const authCalls = ({ send, expect }: Transport) => ({
  getAuthConfig: (): Promise<AuthConfig> =>
    expect({ request: send({ path: AUTH_PATHS.config }), guard: isAuthConfig }),

  getMe: (): Promise<Account> =>
    expect({ request: send({ path: AUTH_PATHS.me }), guard: isAccount }),

  listMembers: ({ pageSize = 100, pageOffset = 0 }: ListMembersProps = {}): Promise<Account[]> =>
    expect({
      request: send({
        path: `${AUTH_PATHS.members}?${toQueryString({ [AUTH_PARAMS.pageSize]: String(pageSize), [AUTH_PARAMS.pageOffset]: String(pageOffset) })}`,
      }),
      guard: isAccountList,
    }),

  setMemberStatus: ({ id, change }: SetMemberStatusProps): Promise<Account> =>
    expect({
      request: send({
        path: AUTH_PATHS.memberStatus.replace(`:${AUTH_PARAMS.id}`, encodeURIComponent(id)),
        method: AUTH_METHODS.post,
        body: change,
      }),
      guard: isAccount,
    }),

  getAccountMediaTicket: ({ id }: GetAccountMediaTicketProps): Promise<MediaTicket> =>
    expect({
      request: send({
        path: AUTH_PATHS.ticket.replace(`:${AUTH_PARAMS.id}`, String(id)),
        method: AUTH_METHODS.post,
      }),
      guard: isMediaTicket,
    }),
})
