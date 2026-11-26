import { SERVER_EVENT_TYPES } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { ServerEvents, isForAccount } from '@/events/serverEvents'

describe('isForAccount', () => {
  it('hands a library event to every stream', () => {
    const envelope = { event: { type: SERVER_EVENT_TYPES.library, libraryId: 4 }, account: null }
    expect(isForAccount({ envelope, account: 'a' })).toBe(true)
    expect(isForAccount({ envelope, account: 'b' })).toBe(true)
  })

  it("hands an account's viewing or binge event to its own streams alone", () => {
    const viewing = { event: { type: SERVER_EVENT_TYPES.viewing }, account: 'a' }
    const binge = { event: { type: SERVER_EVENT_TYPES.binge }, account: 'a' }
    expect(isForAccount({ envelope: viewing, account: 'a' })).toBe(true)
    expect(isForAccount({ envelope: viewing, account: 'b' })).toBe(false)
    expect(isForAccount({ envelope: binge, account: 'a' })).toBe(true)
    expect(isForAccount({ envelope: binge, account: 'b' })).toBe(false)
  })
})

describe('ServerEvents', () => {
  it('names the account on viewing and binge changes, and none on a library change', () => {
    const events = new ServerEvents()
    const heard: unknown[] = []
    events.stream().subscribe((envelope) => heard.push(envelope))
    events.libraryChanged(4)
    events.viewingChanged('a')
    events.bingeChanged('b')
    expect(heard).toEqual([
      { event: { type: SERVER_EVENT_TYPES.library, libraryId: 4 }, account: null },
      { event: { type: SERVER_EVENT_TYPES.viewing }, account: 'a' },
      { event: { type: SERVER_EVENT_TYPES.binge }, account: 'b' },
    ])
  })
})
