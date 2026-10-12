import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminService, TURN_ON_DELAY_MS, isStrongPassword } from '@/admin/adminService'
import { readServerConfig } from '@/config'

const PASSWORD = 'Kestrel-Hall-42'

const serviceWith = (adminPassword: string | null): AdminService =>
  new AdminService({ ...readServerConfig({}), adminPassword })

/** The cookie as a browser sends it back: its name and value, no attributes. */
const sent = (cookie: string): string => cookie.split(';')[0] ?? ''

/** The session cookie a browser gets for the right password. */
const unlocked = (admin: AdminService): string => {
  const unlocking = admin.unlock(PASSWORD)
  if (!unlocking.ok) throw new Error(unlocking.message)
  return sent(unlocking.cookie)
}

describe('isStrongPassword', () => {
  it('asks for ten characters or more, mixing cases, a digit and a symbol', () => {
    expect(isStrongPassword(PASSWORD)).toBe(true)
    expect(isStrongPassword('Owl-Nest-7')).toBe(true)
    expect(isStrongPassword('Owl-Nst-7')).toBe(false)
    expect(isStrongPassword('kestrel-hall-42')).toBe(false)
    expect(isStrongPassword('KESTREL-HALL-42')).toBe(false)
    expect(isStrongPassword('Kestrel-Hall-xx')).toBe(false)
    expect(isStrongPassword('KestrelHall42')).toBe(false)
  })
})

describe('AdminService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is on for a browser until the password is entered there', () => {
    const admin = serviceWith(PASSWORD)
    expect(admin.state({ cookie: undefined })).toEqual({ state: 'on', available: true })
    expect(admin.isLocked({ cookie: undefined })).toBe(true)
    expect(admin.unlock('Kestrel-Hall-43')).toEqual({
      ok: false,
      status: 401,
      message: 'That password is not right.',
    })
    const cookie = unlocked(admin)
    expect(admin.state({ cookie })).toEqual({ state: 'off' })
    expect(admin.isLocked({ cookie })).toBe(false)
  })

  it('turns back on after a wait, unless it is taken back first', () => {
    const admin = serviceWith(PASSWORD)
    const turning = admin.lock({ cookie: unlocked(admin) })
    expect(turning?.lock).toEqual({ state: 'turningOn', remainingMs: TURN_ON_DELAY_MS })
    const waiting = sent(turning?.cookie ?? '')
    expect(admin.isLocked({ cookie: waiting })).toBe(false)

    const kept = admin.keepUnlocked({ cookie: waiting })
    expect(kept?.lock).toEqual({ state: 'off' })
    vi.setSystemTime(Date.now() + TURN_ON_DELAY_MS)
    expect(admin.isLocked({ cookie: sent(kept?.cookie ?? '') })).toBe(false)
    expect(admin.isLocked({ cookie: waiting })).toBe(true)
    expect(admin.state({ cookie: waiting })).toEqual({ state: 'on', available: true })
    expect(admin.keepUnlocked({ cookie: waiting })).toBeNull()
  })

  it('does not draw the wait out when turned on again', () => {
    const admin = serviceWith(PASSWORD)
    const waiting = sent(admin.lock({ cookie: unlocked(admin) })?.cookie ?? '')
    vi.setSystemTime(Date.now() + 10_000)
    expect(admin.lock({ cookie: waiting })).toBeNull()
    expect(admin.state({ cookie: waiting })).toEqual({
      state: 'turningOn',
      remainingMs: TURN_ON_DELAY_MS - 10_000,
    })
  })

  it('comes back on after twelve hours, and on a restart', () => {
    const admin = serviceWith(PASSWORD)
    const cookie = unlocked(admin)
    expect(serviceWith(PASSWORD).isLocked({ cookie })).toBe(true)
    vi.setSystemTime(Date.now() + 12 * 60 * 60_000)
    expect(admin.isLocked({ cookie })).toBe(true)
  })

  it('refuses a cookie it did not sign', () => {
    const admin = serviceWith(PASSWORD)
    const [endsAt = ''] = unlocked(admin).replace('raven_admin=', '').split('.')
    const forged = `raven_admin=${Number(endsAt) + 1}..${'x'.repeat(43)}`
    expect(admin.isLocked({ cookie: forged })).toBe(true)
  })

  it('stays on without a strong password to turn it off', () => {
    const unset = serviceWith(null)
    expect(unset.state({ cookie: undefined })).toEqual({ state: 'on', available: false })
    expect(unset.unlock('')).toMatchObject({ ok: false, status: 503 })
    const weak = serviceWith('hunter2')
    expect(weak.available).toBe(false)
    expect(weak.unlock('hunter2')).toMatchObject({
      ok: false,
      status: 503,
      message: expect.stringContaining('too weak'),
    })
  })

  it('waits a minute after five wrong passwords in a row', () => {
    const admin = serviceWith(PASSWORD)
    const statuses = Array.from({ length: 6 }, () => {
      const unlocking = admin.unlock('Wrong-Guess-1')
      return unlocking.ok ? 200 : unlocking.status
    })
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429])
    expect(admin.unlock(PASSWORD)).toMatchObject({ ok: false, status: 429 })
    vi.setSystemTime(Date.now() + 60_000)
    expect(admin.unlock(PASSWORD)).toMatchObject({ ok: true })
  })
})
