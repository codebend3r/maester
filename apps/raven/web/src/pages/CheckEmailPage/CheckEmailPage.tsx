import { useMutation } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@raven/ui'
import { AUTH_ROUTES } from '@raven/core'
import { Address, AuthCard, Lead, Note } from '@/components/AuthScreen/AuthCard'
import { AUDIENCES, AuthScreen } from '@/components/AuthScreen/AuthScreen'
import { resendFailureCopy } from '@/lib/authErrors'
import { AUTH_QUERY } from '@/lib/authRoutes'
import { resendConfirmation } from '@/lib/session'
import { useCooldown } from '@/lib/useCooldown'
import { useAuthSession } from '@/stores/authSession'
import { CHECK_EMAIL_COPY } from '@/pages/CheckEmailPage/copy'
import styles from '@/pages/CheckEmailPage/CheckEmailPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

/** Whether the page knows which address the link went to. */
const ADDRESS_STATES = { known: 'known', unknown: 'unknown' } as const
type AddressState = (typeof ADDRESS_STATES)[keyof typeof ADDRESS_STATES]

type ResendProps = { address: string }

const Resend = ({ address }: ResendProps) => {
  const isReady = useAuthSession((state) => state.client !== null)
  const cooldown = useCooldown()
  const resend = useMutation({
    mutationFn: () => resendConfirmation({ email: address }),
    onSuccess: cooldown.start,
  })

  return (
    <div className={styles.resend}>
      <Button
        disabled={resend.isPending || cooldown.isCounting || !isReady}
        onClick={() => resend.mutate()}
      >
        {cooldown.isCounting
          ? CHECK_EMAIL_COPY.resendIn(cooldown.secondsLeft)
          : CHECK_EMAIL_COPY.resend}
      </Button>
      {resend.isSuccess && <output>{CHECK_EMAIL_COPY.sent}</output>}
      {resend.isError && <output>{resendFailureCopy(resend.error)}</output>}
    </div>
  )
}

type AddressViewProps = { address: string }

type SentToProps = AddressViewProps

const SentTo = ({ address }: SentToProps) => (
  <>
    {CHECK_EMAIL_COPY.sentTo} <Address>{address}</Address>
    {CHECK_EMAIL_COPY.sentToEnd}
  </>
)

const LookInInbox = () => CHECK_EMAIL_COPY.lookInInbox

const LEADS = {
  [ADDRESS_STATES.known]: SentTo,
  [ADDRESS_STATES.unknown]: LookInInbox,
} as const satisfies Record<AddressState, ComponentType<AddressViewProps>>

const BackToSignIn = () => <Link to={AUTH_ROUTES.signIn}>{COMMON_COPY.backToSignIn}</Link>

const SignInOrUp = () => (
  <>
    <Link to={AUTH_ROUTES.signIn}>{COMMON_COPY.signIn}</Link> {CHECK_EMAIL_COPY.or}{' '}
    <Link to={AUTH_ROUTES.signUp}>{CHECK_EMAIL_COPY.createAccount}</Link>
  </>
)

const WAYS_ON = {
  [ADDRESS_STATES.known]: BackToSignIn,
  [ADDRESS_STATES.unknown]: SignInOrUp,
} as const satisfies Record<AddressState, ComponentType<AddressViewProps>>

const CheckEmailBody = () => {
  const [params] = useSearchParams()
  const address = params.get(AUTH_QUERY.email)?.trim() ?? ''
  const hasAddress = address !== ''
  const addressState = hasAddress ? ADDRESS_STATES.known : ADDRESS_STATES.unknown
  const LeadText: ComponentType<AddressViewProps> = LEADS[addressState]
  const WaysOn: ComponentType<AddressViewProps> = WAYS_ON[addressState]

  return (
    <AuthCard
      title={CHECK_EMAIL_COPY.title}
      lead={
        <Lead>
          <LeadText address={address} />
        </Lead>
      }
    >
      <Note>{CHECK_EMAIL_COPY.approval}</Note>
      {hasAddress && <Resend address={address} />}
      <Note>
        <WaysOn address={address} />
      </Note>
    </AuthCard>
  )
}

/**
 * `/check-email?email=`: where sign up leaves the visitor. It names the address
 * the link went to and can send it again, once a minute.
 */
export const CheckEmailPage = () => (
  <AuthScreen audience={AUDIENCES.signedOut}>
    <CheckEmailBody />
  </AuthScreen>
)
