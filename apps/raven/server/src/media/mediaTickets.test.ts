import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { readServerConfig, type ServerConfig } from '@/config'
import { MediaTickets } from '@/media/mediaTickets'

const config = (secret: Buffer | null): ServerConfig => ({
  ...readServerConfig({}),
  mediaPlane: { origins: [], webOrigins: [], secret, problems: [] },
})

const flip = (text: string): string => `${text.startsWith('A') ? 'B' : 'A'}${text.slice(1)}`

describe('MediaTickets', () => {
  it('signs a ticket that verifies for its id until it expires', () => {
    const tickets = new MediaTickets(config(randomBytes(32)))
    const { ticket, expiresAt } = tickets.issue({ id: 7, now: 1_000_000 })
    expect(expiresAt).toBe(1_000_000 + 21_600_000)
    expect(tickets.verify({ ticket, id: 7, now: expiresAt - 1 })).toBe(true)
    expect(tickets.verify({ ticket, id: 7, now: expiresAt })).toBe(false)
  })

  it('issues from the clock when no time is given', () => {
    const tickets = new MediaTickets(config(randomBytes(32)))
    const { ticket } = tickets.issue({ id: 7 })
    expect(tickets.verify({ ticket, id: 7 })).toBe(true)
  })

  it('rejects another id, a tampered payload, a tampered signature and nonsense', () => {
    const tickets = new MediaTickets(config(randomBytes(32)))
    const { ticket } = tickets.issue({ id: 7, now: 1_000_000 })
    const [payload = '', signature = ''] = ticket.split('.')
    expect(tickets.verify({ ticket, id: 8, now: 1_000_001 })).toBe(false)
    expect(tickets.verify({ ticket: `${flip(payload)}.${signature}`, id: 7, now: 1_000_001 })).toBe(
      false,
    )
    expect(tickets.verify({ ticket: `${payload}.${flip(signature)}`, id: 7, now: 1_000_001 })).toBe(
      false,
    )
    expect(tickets.verify({ ticket: `${ticket}.extra`, id: 7, now: 1_000_001 })).toBe(false)
    expect(tickets.verify({ ticket: 'abc', id: 7, now: 1_000_001 })).toBe(false)
    expect(tickets.verify({ ticket: '', id: 7, now: 1_000_001 })).toBe(false)
  })

  it('rejects a payload that is not two whole numbers, even when it is signed', () => {
    const secret = randomBytes(32)
    const tickets = new MediaTickets(config(secret))
    const { ticket } = tickets.issue({ id: 7, now: 1_000_000 })
    const [, signature = ''] = ticket.split('.')
    const forged = `${Buffer.from('7.1.5').toString('base64url')}.${signature}`
    expect(tickets.verify({ ticket: forged, id: 7, now: 1 })).toBe(false)
  })

  it('rejects a ticket signed with another secret', () => {
    const { ticket } = new MediaTickets(config(randomBytes(32))).issue({ id: 7, now: 1_000_000 })
    expect(
      new MediaTickets(config(randomBytes(32))).verify({ ticket, id: 7, now: 1_000_001 }),
    ).toBe(false)
  })

  it('is off without a secret: isOn false, issue throws, verify false', () => {
    const on = new MediaTickets(config(randomBytes(32)))
    const off = new MediaTickets(config(null))
    expect(on.isOn).toBe(true)
    expect(off.isOn).toBe(false)
    expect(() => off.issue({ id: 7 })).toThrow('RAVEN_MEDIA_SECRET is not set')
    const { ticket } = on.issue({ id: 7, now: 1_000_000 })
    expect(off.verify({ ticket, id: 7, now: 1_000_001 })).toBe(false)
  })
})
