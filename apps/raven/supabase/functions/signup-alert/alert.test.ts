import { deepEqual, equal } from 'node:assert/strict'
import { ENROLMENT_STATUSES, handleSignupAlert, HTTP_METHODS, SIGNUP_ALERT_HEADER } from '@/alert'

const SECRET = 'test-secret'
const ADMIN_URL = 'https://raven.test/admin'

type AlertRequestProps = {
  method?: string
  secret?: string | null
  body?: string | null
}

const alertRequest = ({
  method = HTTP_METHODS.post,
  secret = SECRET,
  body = JSON.stringify({ email: 'friend@maester.test', status: ENROLMENT_STATUSES.approved }),
}: AlertRequestProps) =>
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
    adminUrl: ADMIN_URL,
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
      subject: 'raven: friend@maester.test signed up and is now a member',
      text: "friend@maester.test signed up for raven, confirmed their email and wants to become a member. They signed up before the approval window closed, so raven approved them automatically.\n\nTo remove their access, sign in as the owner and open Users on raven's Admin page: https://raven.test/admin\n",
    },
  ])
})

Deno.test('emails the owner that a pending sign-up wants to become a member', async () => {
  const body = JSON.stringify({ email: 'friend@maester.test', status: ENROLMENT_STATUSES.pending })
  const { status, sent } = await run(alertRequest({ body }))
  equal(status, 204)
  deepEqual(sent, [
    {
      subject: 'raven: friend@maester.test signed up and wants to become a member',
      text: "friend@maester.test signed up for raven, confirmed their email and wants to become a member. They cannot use raven until you approve them.\n\nTo approve them, sign in as the owner and open Users on raven's Admin page: https://raven.test/admin\n",
    },
  ])
})

Deno.test('refuses a request without the shared secret', async () => {
  deepEqual(await run(alertRequest({ secret: null })), { status: 401, sent: [] })
  deepEqual(await run(alertRequest({ secret: 'wrong' })), { status: 401, sent: [] })
})

Deno.test('refuses anything but a POST', async () => {
  deepEqual(await run(alertRequest({ method: HTTP_METHODS.get, body: null })), {
    status: 405,
    sent: [],
  })
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
