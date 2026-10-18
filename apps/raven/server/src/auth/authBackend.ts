import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  AUTH_CONFIG_STATES,
  AUTH_HEADERS,
  AUTH_METHODS,
  AUTH_REFUSALS,
  AUTH_SCHEME,
  type Account,
  type MemberStatusChange,
  isAccountId,
  isBoolean,
  isMemberStatus,
  isRecord,
  isString,
  listOf,
  object,
} from '@raven/core'
import { CACHE_POLICIES, CONTENT_TYPES, HEADERS } from '@shared/server'
import { authFailure } from '@/auth/authFailure'
import { AUTH_FETCH, AUTH_REDIRECT_POLICY, type AuthFetch } from '@/auth/tokenVerifier'
import { SERVER_CONFIG, type ServerConfig } from '@/config'

const RPC_ROOT = '/rest/v1/rpc/'
const RPCS = {
  current: 'current_membership',
  list: 'list_members',
  status: 'set_member_status',
} as const
const SQL_ERRORS = { forbidden: '42501', invalid: '22023', missing: 'P0002' } as const
const isRows = listOf(
  object({ id: isAccountId, email: isString, status: isMemberStatus, is_owner: isBoolean }),
)

@Injectable()
export class AuthBackend {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(AUTH_FETCH) private readonly fetcher: AuthFetch,
  ) {}

  async current({ token }: { token: string }): Promise<Account | null> {
    const rows = await this.rpc({ token, name: RPCS.current, body: {} })
    if (rows.length > 1) throw authFailure(AUTH_REFUSALS.unavailable)
    return rows[0] ?? null
  }

  async list({
    token,
    pageSize,
    pageOffset,
  }: {
    token: string
    pageSize: number
    pageOffset: number
  }): Promise<Account[]> {
    return this.rpc({
      token,
      name: RPCS.list,
      body: { page_size: pageSize, page_offset: pageOffset },
    })
  }

  async setStatus({
    token,
    id,
    change,
  }: {
    token: string
    id: string
    change: MemberStatusChange
  }): Promise<Account> {
    const rows = await this.rpc({
      token,
      name: RPCS.status,
      body: { member_id: id, member_status: change.status },
    })
    const account = rows[0]
    if (
      rows.length !== 1 ||
      account === undefined ||
      account.id !== id ||
      account.status !== change.status
    ) {
      throw authFailure(AUTH_REFUSALS.unavailable)
    }
    return account
  }

  private async rpc({
    token,
    name,
    body,
  }: {
    token: string
    name: (typeof RPCS)[keyof typeof RPCS]
    body: Record<string, unknown>
  }): Promise<Account[]> {
    const { auth } = this.config
    if (auth.state !== AUTH_CONFIG_STATES.ready) throw authFailure(AUTH_REFUSALS.unavailable)
    const response = await this.fetcher({
      url: `${auth.supabaseUrl}${RPC_ROOT}${name}`,
      init: {
        method: AUTH_METHODS.post,
        headers: {
          [AUTH_HEADERS.authorization]: `${AUTH_SCHEME} ${token}`,
          [AUTH_HEADERS.apiKey]: auth.publishableKey,
          [HEADERS.contentType]: CONTENT_TYPES.json,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
        redirect: AUTH_REDIRECT_POLICY,
        cache: CACHE_POLICIES.noStore,
      },
    }).catch(() => {
      throw authFailure(AUTH_REFUSALS.unavailable)
    })
    const value: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      if (response.status === 401) throw authFailure(AUTH_REFUSALS.signedOut)
      const code = isRecord(value) && isString(value.code) ? value.code : null
      if (code === SQL_ERRORS.forbidden && name !== RPCS.current)
        throw authFailure(AUTH_REFUSALS.notOwner)
      if (code === SQL_ERRORS.invalid)
        throw new BadRequestException('Invalid account change or pagination.')
      if (code === SQL_ERRORS.missing) throw new NotFoundException('Verified account not found.')
      throw authFailure(AUTH_REFUSALS.unavailable)
    }
    if (!isRows(value)) throw authFailure(AUTH_REFUSALS.unavailable)
    return value.map(({ id, email, status, is_owner }) => ({
      id,
      email,
      status,
      isOwner: is_owner,
    }))
  }
}
