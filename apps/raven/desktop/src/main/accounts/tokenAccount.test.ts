import { describe, expect, it } from 'bun:test'
import { accountIdOfToken } from '@/main/accounts/tokenAccount'
import { tokenFor } from '@/main/test/accountTokens'

const ACCOUNT_ID = '30000000-0000-4000-8000-00000000000a'

describe('accountIdOfToken', () => {
  it('names the account a token was issued to, from its subject', () => {
    expect(accountIdOfToken(tokenFor({ accountId: ACCOUNT_ID }))).toBe(ACCOUNT_ID)
  })

  it('names none for a token that is not a JWT, or names no subject', () => {
    expect(accountIdOfToken('access-token-one')).toBeNull()
    expect(accountIdOfToken('a.%%%.c')).toBeNull()
    const noSubject = `x.${Buffer.from(JSON.stringify({ aud: 'authenticated' })).toString('base64url')}.y`
    expect(accountIdOfToken(noSubject)).toBeNull()
  })
})
