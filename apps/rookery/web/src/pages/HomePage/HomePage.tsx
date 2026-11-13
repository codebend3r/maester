import { PAGE_PATHS, type PublicUser } from '@rookery/core'
import { type ComponentType, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Frame } from '@/components/Frame/Frame'
import { fetchMe } from '@/lib/api'
import styles from '@/pages/HomePage/HomePage.module.scss'
import { HOME_PAGE_COPY } from '@/pages/HomePage/copy'
import text from '@/styles/text.module.scss'

const HOME_STATE_KINDS = { loading: 'loading', signedIn: 'signed_in', failed: 'failed' } as const

type HomeStateKind = (typeof HOME_STATE_KINDS)[keyof typeof HOME_STATE_KINDS]

type State =
  | { kind: typeof HOME_STATE_KINDS.loading }
  | { kind: typeof HOME_STATE_KINDS.signedIn; user: PublicUser }
  | { kind: typeof HOME_STATE_KINDS.failed }

const AVATAR_KINDS = { picture: 'picture', initial: 'initial' } as const

type AvatarKind = (typeof AVATAR_KINDS)[keyof typeof AVATAR_KINDS]

type UserProps = { user: PublicUser }

const AvatarPicture = ({ user }: UserProps) => (
  <img className={styles.avatar} src={user.thumb ?? undefined} alt="" />
)

const AvatarInitial = ({ user }: UserProps) => (
  <span className={styles.avatar} aria-hidden="true">
    {user.display_name.slice(0, 1).toUpperCase()}
  </span>
)

const AVATARS = {
  [AVATAR_KINDS.picture]: AvatarPicture,
  [AVATAR_KINDS.initial]: AvatarInitial,
} as const satisfies Record<AvatarKind, ComponentType<UserProps>>

const SignedInCard = ({ user }: UserProps) => {
  const Avatar = AVATARS[user.thumb ? AVATAR_KINDS.picture : AVATAR_KINDS.initial]
  return (
    <>
      <div className={styles.who}>
        <Avatar user={user} />
        <h1 className={styles.name}>{HOME_PAGE_COPY.signedInAs(user.display_name)}</h1>
      </div>
      <p className={text.lede}>{HOME_PAGE_COPY.lede}</p>
      <Link className={styles.signOut} to={PAGE_PATHS.logout}>
        {HOME_PAGE_COPY.signOut}
      </Link>
    </>
  )
}

type HomeViewProps = { state: State }

// The view map hands every view the whole state, so this one narrows it to read the user.
const HomeSignedIn = ({ state }: HomeViewProps) =>
  state.kind === HOME_STATE_KINDS.signedIn && <SignedInCard user={state.user} />

const HomeLoading = () => <p className={text.lede}>{HOME_PAGE_COPY.loading}</p>

const HomeFailed = () => (
  <p role="alert" className={text.error}>
    {HOME_PAGE_COPY.failed}
  </p>
)

const HOME_VIEWS = {
  [HOME_STATE_KINDS.loading]: HomeLoading,
  [HOME_STATE_KINDS.signedIn]: HomeSignedIn,
  [HOME_STATE_KINDS.failed]: HomeFailed,
} as const satisfies Record<HomeStateKind, ComponentType<HomeViewProps>>

/** Who is signed in, and a way out. Anyone without a session goes to `/login`. */
export const HomePage = () => {
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: HOME_STATE_KINDS.loading })

  useEffect(() => {
    fetchMe().then(
      (user) =>
        user
          ? setState({ kind: HOME_STATE_KINDS.signedIn, user })
          : navigate(PAGE_PATHS.login, { replace: true }),
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
