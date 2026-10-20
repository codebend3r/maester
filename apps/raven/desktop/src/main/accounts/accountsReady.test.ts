import { describe, expect, it, jest } from 'bun:test'
import { ACCOUNTS_TIMEOUT_MS, accountsReadyWith } from '@/main/accounts/accountsReady'
import { AUTH_STATES, type AuthState } from '@/main/accounts/authConfigs'
import type { SignInConfig } from '@/main/accounts/authEndpoints'

const SERVER = { id: '6f1c1c0e-3b0a-4f4e-8a55-0d2f3c5b7e11', name: 'Vhagar' }

const PIN: SignInConfig = {
  supabaseUrl: 'https://project.supabase.co',
  publishableKey: 'sb_publishable_x',
  webUrl: 'https://raven.example',
}

const READY: AuthState = { kind: AUTH_STATES.ready, signIn: PIN }

const checkWith = ({
  stateOf,
  signIn = null,
}: {
  stateOf: () => Promise<AuthState>
  signIn?: SignInConfig | null
}) => {
  const warnings: string[] = []
  const isReady = accountsReadyWith({
    authConfigs: { stateOf },
    serverOf: (serverId) =>
      serverId === SERVER.id
        ? { ...SERVER, origin: 'https://raven.example', addedAt: 1, signIn }
        : null,
    warn: (message) => warnings.push(message),
  })
  return { isReady, warnings }
}

describe('accountsReadyWith', () => {
  it('answers true for a server whose accounts are ready', async () => {
    const { isReady, warnings } = checkWith({ stateOf: async () => READY })
    expect(await isReady(SERVER)).toBe(true)
    expect(warnings).toEqual([])
  })

  it.each([
    ['off', { kind: AUTH_STATES.off }],
    ['legacy', { kind: AUTH_STATES.legacy }],
    ['down', { kind: AUTH_STATES.down }],
    ['unavailable', { kind: AUTH_STATES.unavailable }],
    ['unreachable', { kind: AUTH_STATES.unreachable }],
  ] as const)('answers false for accounts %s, and says nothing', async (_name, state) => {
    const { isReady, warnings } = checkWith({ stateOf: async () => state })
    expect(await isReady(SERVER)).toBe(false)
    expect(warnings).toEqual([])
  })

  it('answers false for a read that does not answer in time, and says so', async () => {
    jest.useFakeTimers()
    try {
      const { isReady, warnings } = checkWith({ stateOf: () => new Promise<AuthState>(() => {}) })
      const reading = isReady(SERVER)
      jest.advanceTimersByTime(ACCOUNTS_TIMEOUT_MS)
      expect(await reading).toBe(false)
      expect(warnings).toEqual(['raven player could not tell whether Vhagar has accounts in time'])
      expect(ACCOUNTS_TIMEOUT_MS).toBe(3000)
    } finally {
      jest.useRealTimers()
    }
  })

  it('answers true for a pinned server whose read does not answer in time', async () => {
    jest.useFakeTimers()
    try {
      const { isReady } = checkWith({
        stateOf: () => new Promise<AuthState>(() => {}),
        signIn: PIN,
      })
      const reading = isReady(SERVER)
      jest.advanceTimersByTime(ACCOUNTS_TIMEOUT_MS)
      expect(await reading).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  it('answers false for a read that fails, naming nothing it threw', async () => {
    const { isReady, warnings } = checkWith({
      stateOf: () => Promise.reject(new Error('token abc')),
    })
    expect(await isReady(SERVER)).toBe(false)
    expect(warnings).toEqual(['raven player could not tell whether Vhagar has accounts in time'])
  })
})
