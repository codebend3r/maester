import { deepEqual, equal } from 'node:assert/strict'
import { ENROLMENT_STATUSES, handleSignupAlert, SIGNUP_ALERT_HEADER } from '@/alert'

const SECRET = 'test-secret'
const WEB_URL = 'https://raven.test'

const alertRequest = ({
  method = 'POST',
  secret = SECRET,
  body = JSON.stringify({ email: 'friend@maester.test', status: ENROLMENT_STATUSES.approved }),
}: {
  method?: string
  secret?: string | null
  body?: string | null
}) =>
  new Request('https://functions.test/signup-alert', {
    method,
    headers: secret === null ? {} : { [SIGNUP_ALERT_HEADER]: secret },
    body,
  })

const run = async (request: Request) => {
  const sent: { subject: string; text: string }[] = []
  const response = await handleSignupAlert({
    request,
    secret: SECRET,
    webUrl: WEB_URL,
    send: async (message) => {
      sent.push(message)
    },
  })
  return { status: response.status, sent }
}

Deno.test('emails the owner that an approved sign-up can be revoked', async () => {
  const { status, sent } = await run(alertRequest({}))
  equal(status, 204)
  deepEqual(sent, [
    {
      subject: 'raven: friend@maester.test signed up and was approved',
      text: "friend@maester.test confirmed their email and was approved automatically.\n\nTo remove their access, open Users in raven's settings: https://raven.test/settings\n",
    },
  ])
})

Deno.test('emails the owner that a pending sign-up waits for approval', async () => {
  const body = JSON.stringify({ email: 'friend@maester.test', status: ENROLMENT_STATUSES.pending })
  const { status, sent } = await run(alertRequest({ body }))
  equal(status, 204)
  equal(sent[0]?.subject, 'raven: friend@maester.test is waiting for approval')
})

Deno.test('refuses a request without the shared secret', async () => {
  deepEqual(await run(alertRequest({ secret: null })), { status: 401, sent: [] })
  deepEqual(await run(alertRequest({ secret: 'wrong' })), { status: 401, sent: [] })
})

Deno.test('refuses anything but a POST', async () => {
  deepEqual(await run(alertRequest({ method: 'GET', body: null })), { status: 405, sent: [] })
})

Deno.test('refuses a body that is not a sign-up', async () => {
  const bodies = [
    'not json',
    JSON.stringify({ email: '', status: ENROLMENT_STATUSES.approved }),
    JSON.stringify({ email: 'friend@maester.test', status: 'revoked' }),
    JSON.stringify({ status: ENROLMENT_STATUSES.pending }),
  ]
  const results = await Promise.all(bodies.map((body) => run(alertRequest({ body }))))
  deepEqual(
    results,
    bodies.map(() => ({ status: 400, sent: [] })),
  )
})
