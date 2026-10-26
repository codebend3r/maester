import { describe, expect, it } from 'bun:test'
import { createPageAccount } from '@/main/accounts/pageAccount'
import { tokenFor } from '@/main/test/accountTokens'

const ADA = '30000000-0000-4000-8000-00000000000a'
const BEA = '30000000-0000-4000-8000-00000000000b'

type SessionOfProps = { accountId: string; n?: number }

const sessionOf = ({ accountId, n = 1 }: SessionOfProps) => ({
  accessToken: `${tokenFor({ accountId })}${'x'.repeat(n)}`,
  userId: accountId,
})

const world = () => {
  const heard: string[] = []
  const account = createPageAccount({
    onSwitched: () => heard.push('switched'),
    onEnded: () => heard.push('ended'),
  })
  return { account, heard }
}

describe('createPageAccount', () => {
  it('holds no account until the page sends one', () => {
    const { account } = world()
    expect(account.accessToken()).toBeNull()
    expect(account.accountId()).toBeNull()
  })

  it("keeps the page's token and its account, and says the account changed", () => {
    const { account, heard } = world()
    const session = sessionOf({ accountId: ADA })
    expect(account.set(session)).toBe(true)
    expect(account.accessToken()).toBe(session.accessToken)
    expect(account.accountId()).toBe(ADA)
    expect(heard).toEqual(['switched'])
  })

  it('takes a refreshed token for the same account without a word', () => {
    const { account, heard } = world()
    account.set(sessionOf({ accountId: ADA }))
    const refreshed = sessionOf({ accountId: ADA, n: 2 })
    account.set(refreshed)
    expect(account.accessToken()).toBe(refreshed.accessToken)
    expect(heard).toEqual(['switched'])
  })

  it("says the last account's access ended and the account changed, on a switch and on a sign out", () => {
    const { account, heard } = world()
    account.set(sessionOf({ accountId: ADA }))
    expect(heard).toEqual(['switched'])
    account.set(sessionOf({ accountId: BEA }))
    expect(account.accountId()).toBe(BEA)
    expect(heard).toEqual(['switched', 'ended', 'switched'])
    account.set(null)
    expect(account.accessToken()).toBeNull()
    expect(account.accountId()).toBeNull()
    expect(heard).toEqual(['switched', 'ended', 'switched', 'ended', 'switched'])
  })

  it('says nothing for a sign out with no one signed in', () => {
    const { account, heard } = world()
    account.set(null)
    expect(heard).toEqual([])
  })

  it('refuses a token that names another account than the one sent with it, and keeps what it had', () => {
    const { account, heard } = world()
    const session = sessionOf({ accountId: ADA })
    account.set(session)
    expect(account.set({ accessToken: tokenFor({ accountId: BEA }), userId: ADA })).toBe(false)
    expect(account.set({ accessToken: 'not-a-jwt', userId: ADA })).toBe(false)
    expect(account.accessToken()).toBe(session.accessToken)
    expect(heard).toEqual(['switched'])
  })
})
