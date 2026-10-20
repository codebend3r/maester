import { describe, expect, it } from 'bun:test'
import { createTitleSittings, REPORT_KINDS } from '@/main/servers/titleSittings'

const SERVER_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_SERVER_ID = '00000000-0000-4000-8000-000000000002'
const ACCOUNT_A = '30000000-0000-4000-8000-00000000000a'
const ACCOUNT_B = '30000000-0000-4000-8000-00000000000b'
const TITLE = { serverId: SERVER_ID, mediaId: 7 }

const setup = ({ accountId = null }: { accountId?: string | null } = {}) => {
  const signedIn = new Map<string, string | null>([[SERVER_ID, accountId]])
  const sittings = createTitleSittings({
    accountIdOf: ({ serverId }) => signedIn.get(serverId) ?? null,
  })
  return { sittings, signedIn }
}

describe('createTitleSittings', () => {
  it('reports a title it never saw opened as whoever is signed in, as every page call goes', () => {
    const { sittings } = setup({ accountId: ACCOUNT_A })
    expect(sittings.reportAs(TITLE)).toEqual({ kind: REPORT_KINDS.anyone })
  })

  it('reports a title as the account that opened it, whoever signs in after', () => {
    const { sittings, signedIn } = setup({ accountId: ACCOUNT_A })
    sittings.opened(TITLE)
    signedIn.set(SERVER_ID, ACCOUNT_B)
    expect(sittings.reportAs(TITLE)).toEqual({ kind: REPORT_KINDS.account, accountId: ACCOUNT_A })
    signedIn.set(SERVER_ID, null)
    expect(sittings.reportAs(TITLE)).toEqual({ kind: REPORT_KINDS.account, accountId: ACCOUNT_A })
  })

  it('takes the account of each new opening, once the page left the title', () => {
    const { sittings, signedIn } = setup({ accountId: ACCOUNT_A })
    sittings.opened(TITLE)
    signedIn.set(SERVER_ID, ACCOUNT_B)
    sittings.left(TITLE)
    sittings.opened(TITLE)
    expect(sittings.reportAs(TITLE)).toEqual({ kind: REPORT_KINDS.account, accountId: ACCOUNT_B })
  })

  it('keeps the account that opened a title through every reload while the page shows it', () => {
    const { sittings, signedIn } = setup({ accountId: ACCOUNT_A })
    sittings.opened(TITLE)
    signedIn.set(SERVER_ID, ACCOUNT_B)
    sittings.opened(TITLE)
    sittings.opened(TITLE)
    expect(sittings.reportAs(TITLE)).toEqual({ kind: REPORT_KINDS.account, accountId: ACCOUNT_A })
  })

  it('opens the next title as a new sitting, and a late leave of the last one keeps it', () => {
    const { sittings, signedIn } = setup({ accountId: ACCOUNT_A })
    const next = { serverId: SERVER_ID, mediaId: 8 }
    sittings.opened(TITLE)
    signedIn.set(SERVER_ID, ACCOUNT_B)
    sittings.opened(next)
    sittings.left(TITLE)
    signedIn.set(SERVER_ID, ACCOUNT_A)
    sittings.opened(next)
    expect(sittings.reportAs(next)).toEqual({ kind: REPORT_KINDS.account, accountId: ACCOUNT_B })
  })

  it('takes the account signed in now for a title opened again by a new page', () => {
    const { sittings, signedIn } = setup({ accountId: ACCOUNT_A })
    sittings.opened(TITLE)
    signedIn.set(SERVER_ID, ACCOUNT_B)
    sittings.leftAll()
    sittings.opened(TITLE)
    expect(sittings.reportAs(TITLE)).toEqual({ kind: REPORT_KINDS.account, accountId: ACCOUNT_B })
  })

  it('reports nothing of a title opened signed out once an account has signed in', () => {
    const { sittings, signedIn } = setup()
    sittings.opened(TITLE)
    expect(sittings.reportAs(TITLE)).toEqual({ kind: REPORT_KINDS.anyone })
    signedIn.set(SERVER_ID, ACCOUNT_A)
    expect(sittings.reportAs(TITLE)).toEqual({ kind: REPORT_KINDS.nobody })
  })

  it('keeps each title and server apart', () => {
    const { sittings, signedIn } = setup({ accountId: ACCOUNT_A })
    sittings.opened(TITLE)
    signedIn.set(SERVER_ID, ACCOUNT_B)
    expect(sittings.reportAs({ serverId: SERVER_ID, mediaId: 8 })).toEqual({
      kind: REPORT_KINDS.anyone,
    })
    expect(sittings.reportAs({ serverId: OTHER_SERVER_ID, mediaId: 7 })).toEqual({
      kind: REPORT_KINDS.anyone,
    })
  })
})
