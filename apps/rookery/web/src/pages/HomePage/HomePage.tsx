import { type ComponentType, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Frame } from '@/components/Frame/Frame'
import { type User, fetchMe } from '@/lib/api'
import { ROUTES } from '@/lib/routes'
import styles from '@/pages/HomePage/HomePage.module.scss'
import { HOME_PAGE_COPY } from '@/pages/HomePage/copy'

const HOME_STATE_KINDS = { loading: 'loading', signedIn: 'signed_in', failed: 'failed' } as const

type HomeStateKind = (typeof HOME_STATE_KINDS)[keyof typeof HOME_STATE_KINDS]

type State =
  | { kind: typeof HOME_STATE_KINDS.loading }
  | { kind: typeof HOME_STATE_KINDS.signedIn; user: User }
  | { kind: typeof HOME_STATE_KINDS.failed }

const AVATAR_KINDS = { picture: 'picture', initial: 'initial' } as const

type AvatarKind = (typeof AVATAR_KINDS)[keyof typeof AVATAR_KINDS]

type AvatarPictureProps = { user: User }

const AvatarPicture = ({ user }: AvatarPictureProps) => (
  <img className={styles.avatar} src={user.thumb ?? undefined} alt="" />
)

type AvatarInitialProps = { user: User }

const AvatarInitial = ({ user }: AvatarInitialProps) => (
  <span className={styles.avatar} aria-hidden="true">
    {user.display_name.slice(0, 1).toUpperCase()}
  </span>
)

const AVATARS = {
  [AVATAR_KINDS.picture]: AvatarPicture,
  [AVATAR_KINDS.initial]: AvatarInitial,
} as const satisfies Record<AvatarKind, ComponentType<AvatarPictureProps & AvatarInitialProps>>

type SignedInCardProps = { user: User }

const SignedInCard = ({ user }: SignedInCardProps) => {
  const Avatar = AVATARS[user.thumb ? AVATAR_KINDS.picture : AVATAR_KINDS.initial]
  return (
    <>
      <div className={styles.who}>
        <Avatar user={user} />
        <h1 className={styles.title}>{HOME_PAGE_COPY.signedInAs(user.display_name)}</h1>
      </div>
      <p className={styles.lede}>{HOME_PAGE_COPY.lede}</p>
      <Link className={styles.signOut} to={ROUTES.logout}>
        {HOME_PAGE_COPY.signOut}
      </Link>
    </>
  )
}

type HomeSignedInProps = { state: State }

const HomeSignedIn = ({ state }: HomeSignedInProps) =>
  state.kind === HOME_STATE_KINDS.signedIn && <SignedInCard user={state.user} />

const HomeLoading = () => <p className={styles.lede}>{HOME_PAGE_COPY.loading}</p>

const HomeFailed = () => (
  <p role="alert" className={styles.error}>
    {HOME_PAGE_COPY.failed}
  </p>
)

const HOME_VIEWS = {
  [HOME_STATE_KINDS.loading]: HomeLoading,
  [HOME_STATE_KINDS.signedIn]: HomeSignedIn,
  [HOME_STATE_KINDS.failed]: HomeFailed,
} as const satisfies Record<HomeStateKind, ComponentType<HomeSignedInProps>>

/** Who is signed in, and a way out. Anyone without a session goes to `/login`. */
export const HomePage = () => {
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: HOME_STATE_KINDS.loading })

  useEffect(() => {
    fetchMe().then(
      (user) =>
        user
          ? setState({ kind: HOME_STATE_KINDS.signedIn, user })
          : navigate(ROUTES.login, { replace: true }),
      () => setState({ kind: HOME_STATE_KINDS.failed }),
    )
  }, [navigate])

  const View = HOME_VIEWS[state.kind]

  return (
    <Frame>
      <View state={state} />
    </Frame>
  )
}
