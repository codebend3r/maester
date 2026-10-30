import type { ComponentType, ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { AUTH_ROUTES } from '@raven/core'
import { RavenLoader } from '@/components/RavenLoader/RavenLoader'
import { AuthCard, Brand, Lead } from '@/components/AuthScreen/AuthCard'
import { PosterWall } from '@/components/AuthScreen/PosterWall'
import { type AccessKind, ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { HOME_PATH, signInPath } from '@/lib/authRoutes'
import { AUTH_SCREEN_COPY } from '@/components/AuthScreen/copy'
import styles from '@/components/AuthScreen/AuthScreen.module.scss'

/** Who an auth page is for. Anyone else is sent where they belong. */
export const AUDIENCES = {
  /** Sign in, sign up, check email and forgot password. */
  signedOut: 'signedOut',
  /** An email link, which works whoever opens it, and the new password it leads to. */
  anyone: 'anyone',
  /** An account waiting for approval, or whose access was removed. */
  waiting: 'waiting',
} as const

type Audience = (typeof AUDIENCES)[keyof typeof AUDIENCES]

/** Where the server has answered about the visitor; loading, failures and accounts off are the screen's own. */
type Answered = Extract<
  AccessKind,
  | typeof ACCESS_KINDS.signedOut
  | typeof ACCESS_KINDS.pending
  | typeof ACCESS_KINDS.revoked
  | typeof ACCESS_KINDS.approved
>

const ADMITTED: Record<Audience, readonly Answered[]> = {
  [AUDIENCES.signedOut]: [ACCESS_KINDS.signedOut],
  [AUDIENCES.anyone]: [
    ACCESS_KINDS.signedOut,
    ACCESS_KINDS.pending,
    ACCESS_KINDS.revoked,
    ACCESS_KINDS.approved,
  ],
  [AUDIENCES.waiting]: [ACCESS_KINDS.pending, ACCESS_KINDS.revoked],
}

/** Where a visitor a page does not admit belongs, by where the server says they stand. */
const DESTINATIONS = {
  [ACCESS_KINDS.signedOut]: () => signInPath({ returnTo: HOME_PATH }),
  [ACCESS_KINDS.pending]: () => AUTH_ROUTES.pending,
  [ACCESS_KINDS.revoked]: () => AUTH_ROUTES.pending,
  [ACCESS_KINDS.approved]: (approvedTo: string) => approvedTo,
} as const satisfies Record<Answered, (approvedTo: string) => string>

type FrameProps = { children: ReactNode }

const Frame = ({ children }: FrameProps) => (
  <div className={styles.page}>
    <PosterWall />
    <main className={styles.side}>{children}</main>
  </div>
)

const Waiting = () => (
  <section className={styles.card}>
    <Brand />
    <RavenLoader size={24} shouldShowLabel={false} />
  </section>
)

const Unavailable = () => (
  <AuthCard
    title={AUTH_SCREEN_COPY.unavailableTitle}
    lead={<Lead>{AUTH_SCREEN_COPY.unavailableLead}</Lead>}
  />
)

type AuthScreenProps = {
  audience: Audience
  approvedTo?: string
  children: ReactNode
}

type ScreenViewProps = Required<AuthScreenProps>

const ToHome = () => <Navigate replace to={HOME_PATH} />

const Loading = () => (
  <Frame>
    <Waiting />
  </Frame>
)

const Unreachable = () => (
  <Frame>
    <Unavailable />
  </Frame>
)

/** Whether a page lets in the visitor the server has answered about. */
const ADMISSIONS = {
  admitted: 'admitted',
  sent: 'sent',
} as const

type Admission = (typeof ADMISSIONS)[keyof typeof ADMISSIONS]

type AdmissionViewProps = { to: string; children: ReactNode }

const ADMISSION_VIEWS = {
  [ADMISSIONS.admitted]: ({ children }: AdmissionViewProps) => <Frame>{children}</Frame>,
  [ADMISSIONS.sent]: ({ to }: AdmissionViewProps) => <Navigate replace to={to} />,
} as const satisfies Record<Admission, ComponentType<AdmissionViewProps>>

/** The page for a visitor the server has answered about: its own, or a way on to where they belong. */
const answeredView =
  (kind: Answered) =>
  ({ audience, approvedTo, children }: ScreenViewProps) => {
    const isAdmitted = ADMITTED[audience].some((admitted) => admitted === kind)
    const View = ADMISSION_VIEWS[isAdmitted ? ADMISSIONS.admitted : ADMISSIONS.sent]
    return <View to={DESTINATIONS[kind](approvedTo)}>{children}</View>
  }

const SCREEN_VIEWS = {
  [ACCESS_KINDS.disabled]: ToHome,
  [ACCESS_KINDS.loading]: Loading,
  [ACCESS_KINDS.unavailable]: Unreachable,
  [ACCESS_KINDS.failed]: Unreachable,
  [ACCESS_KINDS.signedOut]: answeredView(ACCESS_KINDS.signedOut),
  [ACCESS_KINDS.pending]: answeredView(ACCESS_KINDS.pending),
  [ACCESS_KINDS.revoked]: answeredView(ACCESS_KINDS.revoked),
  [ACCESS_KINDS.approved]: answeredView(ACCESS_KINDS.approved),
} as const satisfies Record<AccessKind, ComponentType<ScreenViewProps>>

/**
 * The screen every page of the auth flow sits in, beside the poster wall.
 * While accounts are off the page is not there; while they cannot be
 * reached it says so instead of showing a form that cannot work. Otherwise
 * it shows `children` to its `audience` and sends anyone else on: to sign
 * in, to the pending page, or, once approved, to `approvedTo`.
 */
export const AuthScreen = ({ audience, approvedTo = HOME_PATH, children }: AuthScreenProps) => {
  const access = useAccessState()
  const View = SCREEN_VIEWS[access.kind]
  return (
    <View audience={audience} approvedTo={approvedTo}>
      {children}
    </View>
  )
}
