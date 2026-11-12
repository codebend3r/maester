import { createHash, timingSafeEqual } from 'node:crypto'

export const SIGNUP_ALERT_HEADER = 'x-signup-alert-secret'

export const HTTP_METHODS = { get: 'GET', post: 'POST' } as const

export const ENROLMENT_STATUSES = { approved: 'approved', pending: 'pending' } as const
type EnrolmentStatus = (typeof ENROLMENT_STATUSES)[keyof typeof ENROLMENT_STATUSES]

type SignupAlert = { email: string; status: EnrolmentStatus }
type AlertMessage = { subject: string; text: string }

const isEnrolmentStatus = (value: unknown): value is EnrolmentStatus =>
  Object.values(ENROLMENT_STATUSES).some((status) => status === value)

const isSignupAlert = (value: unknown): value is SignupAlert =>
  typeof value === 'object' &&
  value !== null &&
  'email' in value &&
  typeof value.email === 'string' &&
  value.email.length > 0 &&
  'status' in value &&
  isEnrolmentStatus(value.status)

// Hashing first gives timingSafeEqual the equal lengths it requires.
const digest = (value: string) => createHash('sha256').update(value).digest()

type IsSameSecretProps = { given: string; expected: string }

const isSameSecret = ({ given, expected }: IsSameSecretProps) =>
  timingSafeEqual(digest(given), digest(expected))

type ComposeAlertProps = {
  alert: SignupAlert
  adminUrl: string
}

const composeAlert = ({ alert, adminUrl }: ComposeAlertProps): AlertMessage => {
  switch (alert.status) {
    case ENROLMENT_STATUSES.approved:
      return {
        subject: `raven: ${alert.email} signed up and is now a member`,
        text: `${alert.email} signed up for raven, confirmed their email and wants to become a member. They signed up before the approval window closed, so raven approved them automatically.\n\nTo remove their access, sign in as the owner and open Users on raven's Admin page: ${adminUrl}\n`,
      }
    case ENROLMENT_STATUSES.pending:
      return {
        subject: `raven: ${alert.email} signed up and wants to become a member`,
        text: `${alert.email} signed up for raven, confirmed their email and wants to become a member. They cannot use raven until you approve them.\n\nTo approve them, sign in as the owner and open Users on raven's Admin page: ${adminUrl}\n`,
      }
    default: {
      const unhandled: never = alert.status
      throw new Error(`Unhandled enrolment status ${String(unhandled)}`)
    }
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

type HandleSignupAlertProps = {
  request: Request
  secret: string
  adminUrl: string
  send: (message: AlertMessage) => Promise<void>
}

export const handleSignupAlert = async ({
  request,
  secret,
  adminUrl,
  send,
}: HandleSignupAlertProps) => {
  if (request.method !== HTTP_METHODS.post) return new Response(null, { status: 405 })
  const given = request.headers.get(SIGNUP_ALERT_HEADER) ?? ''
  if (!isSameSecret({ given, expected: secret })) return new Response(null, { status: 401 })
  const body = await readBody({ request })
  if (!isSignupAlert(body)) return new Response(null, { status: 400 })
  await send(composeAlert({ alert: body, adminUrl }))
  return new Response(null, { status: 204 })
}
