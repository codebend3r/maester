import { describe, expect, it } from 'bun:test'
import {
  SESSION_KINDS,
  SESSION_PARAMS,
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

  it('takes a shuffle only with the show it draws from', () => {
    expect(isViewingSession({ kind: SESSION_KINDS.shuffle, showId: '42' })).toBe(true)
    expect(isViewingSession({ kind: SESSION_KINDS.shuffle })).toBe(false)
    expect(isViewingSession({ kind: SESSION_KINDS.shuffle, showId: '0' })).toBe(false)
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
      { kind: SESSION_KINDS.shuffle, showId: '42' },
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
    expect(readSessionQuery({ session: SESSION_KINDS.shuffle, scope: undefined })).toBeNull()
    expect(readSessionQuery({ session: SESSION_KINDS.shuffle, scope: '-1' })).toBeNull()
  })

  it('reads a shuffle with the show its scope names', () => {
    expect(readSessionQuery({ session: SESSION_KINDS.shuffle, scope: '7' })).toEqual({
      kind: SESSION_KINDS.shuffle,
      showId: '7',
    })
    expect(sessionQueryOf({ kind: SESSION_KINDS.shuffle, showId: '7' })).toEqual({
      [SESSION_PARAMS.session]: SESSION_KINDS.shuffle,
      [SESSION_PARAMS.scope]: '7',
    })
  })
})

describe('asksServerForNext', () => {
  it('asks for a season, a show, a saga or a shuffle, and never for a film on its own or a queue', () => {
    expect(asksServerForNext({ kind: SESSION_KINDS.season })).toBe(true)
    expect(asksServerForNext({ kind: SESSION_KINDS.show })).toBe(true)
    expect(asksServerForNext({ kind: SESSION_KINDS.saga, sagaId: '119' })).toBe(true)
    expect(asksServerForNext({ kind: SESSION_KINDS.shuffle, showId: '42' })).toBe(true)
    expect(asksServerForNext({ kind: SESSION_KINDS.single })).toBe(false)
    expect(asksServerForNext({ kind: SESSION_KINDS.queue })).toBe(false)
  })
})
