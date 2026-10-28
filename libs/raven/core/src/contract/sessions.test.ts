import { describe, expect, it } from 'bun:test'
import {
  SESSION_KINDS,
  asksServerForNext,
  isViewingSession,
  readSessionQuery,
  sessionQueryOf,
} from '@/contract/sessions'

describe('isViewingSession', () => {
  it('takes a saga only with the TMDB collection it walks', () => {
    expect(isViewingSession({ kind: SESSION_KINDS.show })).toBe(true)
    expect(isViewingSession({ kind: SESSION_KINDS.saga, sagaId: '119' })).toBe(true)
    expect(isViewingSession({ kind: SESSION_KINDS.saga })).toBe(false)
    expect(isViewingSession({ kind: SESSION_KINDS.saga, sagaId: '0' })).toBe(false)
    expect(isViewingSession({ kind: 'binge' })).toBe(false)
  })
})

describe('sessionQueryOf and readSessionQuery', () => {
  it('round-trip every session through a query', () => {
    const sessions = [
      { kind: SESSION_KINDS.single },
      { kind: SESSION_KINDS.season },
      { kind: SESSION_KINDS.show },
      { kind: SESSION_KINDS.queue },
      { kind: SESSION_KINDS.saga, sagaId: '119' },
    ] as const
    sessions.forEach((session) => {
      const { session: kind, scope } = sessionQueryOf(session)
      expect(readSessionQuery({ session: kind, scope })).toEqual(session)
    })
  })

  it('reads nothing from a query that names no session', () => {
    expect(readSessionQuery({ session: undefined, scope: undefined })).toBeNull()
    expect(readSessionQuery({ session: 'binge', scope: undefined })).toBeNull()
    expect(readSessionQuery({ session: SESSION_KINDS.saga, scope: 'x' })).toBeNull()
  })
})

describe('asksServerForNext', () => {
  it('asks for a season, a show or a saga, and never for a film on its own or a queue', () => {
    expect(asksServerForNext({ kind: SESSION_KINDS.season })).toBe(true)
    expect(asksServerForNext({ kind: SESSION_KINDS.show })).toBe(true)
    expect(asksServerForNext({ kind: SESSION_KINDS.saga, sagaId: '119' })).toBe(true)
    expect(asksServerForNext({ kind: SESSION_KINDS.single })).toBe(false)
    expect(asksServerForNext({ kind: SESSION_KINDS.queue })).toBe(false)
  })
})
