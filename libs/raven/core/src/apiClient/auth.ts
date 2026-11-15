import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import {
  type Account,
  AUTH_PARAMS,
  type AuthConfig,
  type MediaTicket,
  type MemberStatusChange,
} from '@/contract'

type ListMembersProps = { pageSize?: number; pageOffset?: number }

type SetMemberStatusProps = {
  id: string
  change: MemberStatusChange
}

type GetAccountMediaTicketProps = { id: number }

/** The account's own routes: its configuration, who it is, the members, and the ticket a title plays by. */
export const authCalls = ({ ask }: Transport) => ({
  getAuthConfig: (): Promise<AuthConfig> => ask({ route: ROUTES.getAuthConfig }),

  getMe: (): Promise<Account> => ask({ route: ROUTES.getMe }),

  listMembers: ({ pageSize = 100, pageOffset = 0 }: ListMembersProps = {}): Promise<Account[]> =>
    ask({
      route: ROUTES.listMembers,
      query: {
        [AUTH_PARAMS.pageSize]: String(pageSize),
        [AUTH_PARAMS.pageOffset]: String(pageOffset),
      },
    }),

  setMemberStatus: ({ id, change }: SetMemberStatusProps): Promise<Account> =>
    ask({ route: ROUTES.setMemberStatus, params: { [AUTH_PARAMS.id]: id }, body: change }),

  getAccountMediaTicket: ({ id }: GetAccountMediaTicketProps): Promise<MediaTicket> =>
    ask({ route: ROUTES.getAccountMediaTicket, params: { [AUTH_PARAMS.id]: id } }),
})
