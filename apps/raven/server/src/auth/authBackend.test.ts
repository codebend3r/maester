import { AUTH_REFUSALS, isAuthRefusal } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { AuthBackend } from '@/auth/authBackend'
import { INTEGRITY_FAILURES, IntegrityFailure } from '@/auth/authFailure'
import { AUTH_TEST_CONFIG, AUTH_TEST_FAILURES, AUTH_TEST_IDS, authFixture } from '@/test/auth'

const setup = async () => {
  const fixture = await authFixture()
  const token = await fixture.mint({ id: AUTH_TEST_IDS.friend })
  return { fixture, token, backend: new AuthBackend(AUTH_TEST_CONFIG, fixture.fetcher) }
}

const refusalOf = async (attempt: Promise<unknown>): Promise<unknown> =>
  attempt.then(
    () => null,
    (error: unknown) => error,
  )

describe('the membership answer is trusted only when it is whole', () => {
  it('reads the one row it asks for', async () => {
    const { backend, token } = await setup()
    expect(await backend.current({ token })).toMatchObject({ id: AUTH_TEST_IDS.friend })
  })

  it('answers no account for a token with no membership row', async () => {
    const { backend, fixture } = await setup()
    const token = await fixture.mint({ id: AUTH_TEST_IDS.missing })
    expect(await backend.current({ token })).toBeNull()
  })

  it('fails on more than one membership row as an integrity failure, not an outage', async () => {
    const { backend, fixture, token } = await setup()
    fixture.state.failure = AUTH_TEST_FAILURES.ambiguous
    const error = await refusalOf(backend.current({ token }))
    expect(error).toBeInstanceOf(IntegrityFailure)
    expect(error).toMatchObject({ failure: INTEGRITY_FAILURES.ambiguousMembership })
  })

  it('fails on malformed rows as an integrity failure, not an outage', async () => {
    const { backend, fixture, token } = await setup()
    fixture.state.failure = AUTH_TEST_FAILURES.malformed
    const error = await refusalOf(backend.current({ token }))
    expect(error).toBeInstanceOf(IntegrityFailure)
    expect(error).toMatchObject({ failure: INTEGRITY_FAILURES.malformedMembership })
  })

  it.each([AUTH_TEST_FAILURES.ambiguous, AUTH_TEST_FAILURES.malformed])(
    'still tells a client only that accounts are unavailable: %s',
    async (failure) => {
      const { backend, fixture, token } = await setup()
      fixture.state.failure = failure
      const error = await refusalOf(backend.current({ token }))
      expect(error).toMatchObject({ status: 503 })
      const body = error instanceof IntegrityFailure ? error.getResponse() : null
      expect(isAuthRefusal(body) ? body.reason : null).toBe(AUTH_REFUSALS.unavailable)
    },
  )

  it('keeps a network failure a plain outage', async () => {
    const { backend, fixture, token } = await setup()
    fixture.state.failure = AUTH_TEST_FAILURES.network
    const error = await refusalOf(backend.current({ token }))
    expect(error).not.toBeInstanceOf(IntegrityFailure)
    expect(error).toMatchObject({ status: 503 })
  })
})
