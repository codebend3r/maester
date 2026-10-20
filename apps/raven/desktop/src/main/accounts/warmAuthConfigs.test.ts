import { describe, expect, it } from 'bun:test'
import { warmAuthConfigs } from '@/main/accounts/warmAuthConfigs'
import { AUTH_STATES, type AuthState } from '@/main/accounts/authConfigs'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

const OFF: AuthState = { kind: AUTH_STATES.off }

describe('warmAuthConfigs', () => {
  it('reads every stored server once', async () => {
    const read: string[] = []
    await warmAuthConfigs({
      servers: [{ id: A }, { id: B }, { id: C }],
      authConfigs: {
        stateOf: async (serverId) => {
          read.push(serverId)
          return OFF
        },
      },
      warn: () => {},
    })
    expect(read.toSorted()).toEqual([A, B, C])
  })

  it('reads nothing when no server is stored', async () => {
    const read: string[] = []
    await warmAuthConfigs({
      servers: [],
      authConfigs: {
        stateOf: async (serverId) => {
          read.push(serverId)
          return OFF
        },
      },
      warn: () => {},
    })
    expect(read).toEqual([])
  })

  it('reads the servers together, not one after another', async () => {
    const started: string[] = []
    const release: Array<() => void> = []
    const done = warmAuthConfigs({
      servers: [{ id: A }, { id: B }],
      authConfigs: {
        stateOf: (serverId) =>
          new Promise<AuthState>((resolve) => {
            started.push(serverId)
            release.push(() => resolve(OFF))
          }),
      },
      warn: () => {},
    })
    expect(started).toEqual([A, B])
    release.forEach((resolve) => resolve())
    await done
  })

  it('only warns about a read that fails, by server id, and still reads the rest', async () => {
    const warnings: string[] = []
    const read: string[] = []
    await warmAuthConfigs({
      servers: [{ id: A }, { id: B }],
      authConfigs: {
        stateOf: async (serverId) => {
          read.push(serverId)
          if (serverId === A) throw new Error('Bearer eyJ.secret.token went wrong')
          return OFF
        },
      },
      warn: (message) => warnings.push(message),
    })
    expect(read.toSorted()).toEqual([A, B])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(A)
    expect(warnings[0]).not.toContain(B)
    expect(warnings[0]).not.toContain('secret')
  })

  it('does not warn when every read is answered, even with an unreachable server', async () => {
    const warnings: string[] = []
    await warmAuthConfigs({
      servers: [{ id: A }],
      authConfigs: { stateOf: async () => ({ kind: AUTH_STATES.unreachable }) },
      warn: (message) => warnings.push(message),
    })
    expect(warnings).toEqual([])
  })
})
