import { deepEqual, equal, ok } from 'node:assert/strict'
import {
  ENROLMENT_STATUSES,
  HTTP_METHODS,
  MEMBER_EVENTS,
  type MemberMail,
  SIGNUP_ALERT_HEADER,
  handleMemberMail,
} from '@/alert'
import { escapeHtml, mailHtml } from '@/template'

const SECRET = 'test-secret'
const OWNER = 'owner@maester.test'
const LINKS = { admin: 'https://raven.test/admin', signIn: 'https://raven.test/' }

type MailRequestProps = {
  method?: string
  secret?: string | null
  body?: string | null
}

const signedUp = (status: string) =>
  JSON.stringify({ event: MEMBER_EVENTS.signedUp, email: 'friend@maester.test', status })

const mailRequest = ({
  method = HTTP_METHODS.post,
  secret = SECRET,
  body = signedUp(ENROLMENT_STATUSES.approved),
}: MailRequestProps) =>
  new Request('https://functions.test/signup-alert', {
    method,
    headers: secret === null ? {} : { [SIGNUP_ALERT_HEADER]: secret },
    body,
  })

const run = async (request: Request) => {
  const sent: MemberMail[] = []
  const response = await handleMemberMail({
    request,
    secret: SECRET,
    owner: OWNER,
    links: LINKS,
    send: async (mail) => {
      sent.push(mail)
    },
  })
  return { status: response.status, sent }
}

/** The mail without its HTML, which the template's own tests cover. */
const wordsOf = ({ to, subject, text }: MemberMail) => ({ to, subject, text })

Deno.test('emails the owner that an approved sign-up can be revoked', async () => {
  const { status, sent } = await run(mailRequest({}))
  equal(status, 204)
  deepEqual(sent.map(wordsOf), [
    {
      to: OWNER,
      subject: 'raven: friend@maester.test signed up and is now a member',
      text: 'friend@maester.test signed up for raven, confirmed their email and wants to become a member.\n\nThey signed up before the approval window closed, so raven approved them automatically. To remove their access, sign in as the owner and open Users on the Admin page.\n\nOpen Users: https://raven.test/admin\n',
    },
  ])
})

Deno.test('emails the owner that a pending sign-up wants to become a member', async () => {
  const { status, sent } = await run(mailRequest({ body: signedUp(ENROLMENT_STATUSES.pending) }))
  equal(status, 204)
  deepEqual(sent.map(wordsOf), [
    {
      to: OWNER,
      subject: 'raven: friend@maester.test signed up and wants to become a member',
      text: 'friend@maester.test signed up for raven, confirmed their email and wants to become a member.\n\nThey cannot use raven until you approve them. To approve them, sign in as the owner and open Users on the Admin page.\n\nOpen Users: https://raven.test/admin\n',
    },
  ])
})

Deno.test('emails a member that the owner approved them, with the way to sign in', async () => {
  const body = JSON.stringify({ event: MEMBER_EVENTS.approved, email: 'friend@maester.test' })
  const { status, sent } = await run(mailRequest({ body }))
  equal(status, 204)
  deepEqual(sent.map(wordsOf), [
    {
      to: 'friend@maester.test',
      subject: 'Your raven account is approved',
      text: 'The owner approved your raven account, friend@maester.test. Everything in the libraries is yours to watch and listen to.\n\nSign in with the email and password you signed up with.\n\nOpen raven: https://raven.test/\n',
    },
  ])
  ok((sent[0]?.html ?? '').includes('href="https://raven.test/"'))
})

Deno.test('sends each email as HTML too, with the address escaped', async () => {
  const body = JSON.stringify({
    event: MEMBER_EVENTS.signedUp,
    email: '<b>friend</b>@maester.test',
    status: ENROLMENT_STATUSES.pending,
  })
  const { sent } = await run(mailRequest({ body }))
  const html = sent[0]?.html ?? ''
  ok(html.startsWith('<!doctype html>'))
  ok(html.includes('&lt;b&gt;friend&lt;/b&gt;@maester.test'))
  ok(!html.includes('<b>friend</b>'))
  ok(html.includes('href="https://raven.test/admin"'))
})

Deno.test('escapes every character that could become markup', () => {
  equal(
    escapeHtml(`<a href="x" onclick='y'>&</a>`),
    '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
  )
  const html = mailHtml({
    heading: 'Hi & welcome',
    paragraphs: ['One', 'Two'],
    action: { label: 'Go', url: 'https://raven.test/?a=1&b=2' },
  })
  ok(html.includes('Hi &amp; welcome'))
  ok(html.includes('href="https://raven.test/?a=1&amp;b=2"'))
})

Deno.test('refuses a request without the shared secret', async () => {
  deepEqual(await run(mailRequest({ secret: null })), { status: 401, sent: [] })
  deepEqual(await run(mailRequest({ secret: 'wrong' })), { status: 401, sent: [] })
})

Deno.test('refuses anything but a POST', async () => {
  deepEqual(await run(mailRequest({ method: HTTP_METHODS.get, body: null })), {
    status: 405,
    sent: [],
  })
})

Deno.test('refuses a body that is no member event', async () => {
  const bodies = [
    'not json',
    JSON.stringify({
      event: MEMBER_EVENTS.signedUp,
      email: '',
      status: ENROLMENT_STATUSES.approved,
    }),
    JSON.stringify({
      event: MEMBER_EVENTS.signedUp,
      email: 'friend@maester.test',
      status: 'revoked',
    }),
    JSON.stringify({ event: MEMBER_EVENTS.signedUp, status: ENROLMENT_STATUSES.pending }),
    JSON.stringify({ email: 'friend@maester.test', status: ENROLMENT_STATUSES.pending }),
    JSON.stringify({ event: 'revoked', email: 'friend@maester.test' }),
    JSON.stringify({ event: MEMBER_EVENTS.approved }),
  ]
  const results = await Promise.all(bodies.map((body) => run(mailRequest({ body }))))
  deepEqual(
    results,
    bodies.map(() => ({ status: 400, sent: [] })),
  )
})
