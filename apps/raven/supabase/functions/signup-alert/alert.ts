import { createHash, timingSafeEqual } from 'node:crypto'
import { type MailPage, mailHtml } from '@/template'

export const SIGNUP_ALERT_HEADER = 'x-signup-alert-secret'

export const HTTP_METHODS = { get: 'GET', post: 'POST' } as const

export const ENROLMENT_STATUSES = { approved: 'approved', pending: 'pending' } as const
type EnrolmentStatus = (typeof ENROLMENT_STATUSES)[keyof typeof ENROLMENT_STATUSES]

/** What the database tells the function happened: someone signed up, or a member was approved. */
export const MEMBER_EVENTS = { signedUp: 'signedUp', approved: 'approved' } as const

type SignedUp = { event: typeof MEMBER_EVENTS.signedUp; email: string; status: EnrolmentStatus }
type Approved = { event: typeof MEMBER_EVENTS.approved; email: string }
type MemberEvent = SignedUp | Approved

/** One email to send: to whom, its subject, and its words as plain text and as HTML. */
export type MemberMail = { to: string; subject: string; text: string; html: string }

const isEnrolmentStatus = (value: unknown): value is EnrolmentStatus =>
  Object.values(ENROLMENT_STATUSES).some((status) => status === value)

const hasEmail = (value: unknown): value is { email: string } =>
  typeof value === 'object' &&
  value !== null &&
  'email' in value &&
  typeof value.email === 'string' &&
  value.email.length > 0

const isSignedUp = (value: unknown): value is SignedUp =>
  hasEmail(value) &&
  'event' in value &&
  value.event === MEMBER_EVENTS.signedUp &&
  'status' in value &&
  isEnrolmentStatus(value.status)

const isApproved = (value: unknown): value is Approved =>
  hasEmail(value) && 'event' in value && value.event === MEMBER_EVENTS.approved

const isMemberEvent = (value: unknown): value is MemberEvent =>
  isSignedUp(value) || isApproved(value)

// Hashing first gives timingSafeEqual the equal lengths it requires.
const digest = (value: string) => createHash('sha256').update(value).digest()

type IsSameSecretProps = { given: string; expected: string }

const isSameSecret = ({ given, expected }: IsSameSecretProps) =>
  timingSafeEqual(digest(given), digest(expected))

/** Where the emails lead: the owner's Users section, and raven itself for a member to sign in. */
type MailLinks = { admin: string; signIn: string }

type Wording = { subject: string; page: MailPage }

type WordingOfProps = { event: MemberEvent; links: MailLinks }

type SignedUpWordingProps = { event: SignedUp; links: MailLinks }

const signedUpWording = ({ event, links }: SignedUpWordingProps): Wording => {
  const users = { label: 'Open Users', url: links.admin }
  switch (event.status) {
    case ENROLMENT_STATUSES.approved:
      return {
        subject: `raven: ${event.email} signed up and is now a member`,
        page: {
          heading: 'A new member joined raven',
          paragraphs: [
            `${event.email} signed up for raven, confirmed their email and wants to become a member.`,
            'They signed up before the approval window closed, so raven approved them automatically. To remove their access, sign in as the owner and open Users on the Admin page.',
          ],
          action: users,
        },
      }
    case ENROLMENT_STATUSES.pending:
      return {
        subject: `raven: ${event.email} signed up and wants to become a member`,
        page: {
          heading: 'Someone is waiting for your approval',
          paragraphs: [
            `${event.email} signed up for raven, confirmed their email and wants to become a member.`,
            'They cannot use raven until you approve them. To approve them, sign in as the owner and open Users on the Admin page.',
          ],
          action: users,
        },
      }
    default: {
      const unhandled: never = event.status
      throw new Error(`Unhandled enrolment status ${String(unhandled)}`)
    }
  }
}

const wordingOf = ({ event, links }: WordingOfProps): Wording => {
  switch (event.event) {
    case MEMBER_EVENTS.signedUp:
      return signedUpWording({ event, links })
    case MEMBER_EVENTS.approved:
      return {
        subject: 'Your raven account is approved',
        page: {
          heading: 'You are in',
          paragraphs: [
            `The owner approved your raven account, ${event.email}. Everything in the libraries is yours to watch and listen to.`,
            'Sign in with the email and password you signed up with.',
          ],
          action: { label: 'Open raven', url: links.signIn },
        },
      }
    default: {
      const unhandled: never = event
      throw new Error(`Unhandled member event ${String(unhandled)}`)
    }
  }
}

/** The plain text beside the HTML, for a client that shows no HTML: the paragraphs, then the link. */
const textOf = ({ paragraphs, action }: MailPage): string =>
  `${paragraphs.join('\n\n')}\n\n${action.label}: ${action.url}\n`

type ComposeMailProps = WordingOfProps & {
  /** The owner's address, who hears of every sign-up. */
  owner: string
}

type RecipientOfProps = Pick<ComposeMailProps, 'event' | 'owner'>

/** Who an event's email goes to: the owner for a sign-up, the member for their approval. */
const recipientOf = ({ event, owner }: RecipientOfProps): string =>
  event.event === MEMBER_EVENTS.approved ? event.email : owner

const composeMail = ({ event, links, owner }: ComposeMailProps): MemberMail => {
  const { subject, page } = wordingOf({ event, links })
  return {
    to: recipientOf({ event, owner }),
    subject,
    text: textOf(page),
    html: mailHtml(page),
  }
}

type ReadBodyProps = { request: Request }

const readBody = async ({ request }: ReadBodyProps): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return null
  }
}

type HandleMemberMailProps = {
  request: Request
  secret: string
  owner: string
  links: MailLinks
  send: (mail: MemberMail) => Promise<void>
}

/**
 * The database's call when a membership changes: it checks the shared secret, reads which event
 * it was, and sends that event's email, the owner's alert of a sign-up or a member's approval.
 */
export const handleMemberMail = async ({
  request,
  secret,
  owner,
  links,
  send,
}: HandleMemberMailProps) => {
  if (request.method !== HTTP_METHODS.post) return new Response(null, { status: 405 })
  const given = request.headers.get(SIGNUP_ALERT_HEADER) ?? ''
  if (!isSameSecret({ given, expected: secret })) return new Response(null, { status: 401 })
  const body = await readBody({ request })
  if (!isMemberEvent(body)) return new Response(null, { status: 400 })
  await send(composeMail({ event: body, links, owner }))
  return new Response(null, { status: 204 })
}
