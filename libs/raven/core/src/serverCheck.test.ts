import { describe, expect, it } from 'bun:test'
import {
  CHECK_OUTCOMES,
  SERVER_CHECK_PROBLEMS,
  type ServerCheckProblem,
  checkServerAt,
} from '@/serverCheck'
import { SERVERS_CAP } from '@/serverList'

const HOME = { origin: 'https://home.example', serverId: '11111111-2222-4333-8444-555555555555' }
const NEW_ID = '66666666-7777-4888-9999-000000000000'
const ORIGIN = 'https://new.example'

type HealthIdAt = Parameters<typeof checkServerAt>[0]['healthIdAt']

const answering =
  (serverId: string | null): HealthIdAt =>
  async () => ({ serverId })

const silent: HealthIdAt = async () => null

type Refusal = [string, string, HealthIdAt, ServerCheckProblem]

const REFUSALS: Refusal[] = [
  ['listed by address', HOME.origin, answering(NEW_ID), SERVER_CHECK_PROBLEMS.listed],
  ['listed by id', ORIGIN, answering(HOME.serverId), SERVER_CHECK_PROBLEMS.listed],
  ['not answering', ORIGIN, silent, SERVER_CHECK_PROBLEMS.unreachable],
  ['too old', ORIGIN, answering(null), SERVER_CHECK_PROBLEMS.tooOld],
]

describe('checkServerAt', () => {
  it('is ready with the id the server names', async () => {
    expect(
      await checkServerAt({ origin: ORIGIN, servers: [HOME], healthIdAt: answering(NEW_ID) }),
    ).toEqual({ kind: CHECK_OUTCOMES.ready, serverId: NEW_ID, origin: ORIGIN })
  })

  it.each(REFUSALS)('refuses a server %s', async (_, origin, healthIdAt, problem) => {
    expect(await checkServerAt({ origin, servers: [HOME], healthIdAt })).toEqual({
      kind: CHECK_OUTCOMES.refused,
      problem,
    })
  })

  it('refuses once home and SERVERS_CAP others are listed', async () => {
    const others = Array.from({ length: SERVERS_CAP }, (_, index) => ({
      origin: `https://s${index}.example`,
      serverId: null,
    }))
    expect(
      await checkServerAt({
        origin: ORIGIN,
        servers: [HOME, ...others],
        healthIdAt: answering(NEW_ID),
      }),
    ).toEqual({ kind: CHECK_OUTCOMES.refused, problem: SERVER_CHECK_PROBLEMS.full })
  })
})
