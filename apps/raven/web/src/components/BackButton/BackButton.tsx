import type { ComponentType } from 'react'
import { BUTTON_TONES, Button, ButtonLink, useCanGoBack, classNames } from '@raven/ui'
import { useLocation, useNavigate } from 'react-router-dom'
import { BACK_BUTTON_COPY } from '@/components/BackButton/copy'
import styles from '@/components/BackButton/BackButton.module.scss'
import { COMMON_COPY } from '@/lib/copy'
import { APP_PATHS } from '@/lib/appPaths'
import { MUSIC_PATHS } from '@/lib/music'

/** Where a page goes back to when nothing of the app is behind it, and what it is called. */
export type BackFallback = { to: string; label: string }

/** The way back for a page that hangs off the home page. */
export const HOME = { to: APP_PATHS.home, label: COMMON_COPY.home } as const satisfies BackFallback

/** Which way back there is: the app's own history, the fallback, or none. */
const BACK_WAYS = { history: 'history', fallback: 'fallback', none: 'none' } as const

type BackWay = (typeof BACK_WAYS)[keyof typeof BACK_WAYS]

type BackWayProps = { fallback: BackFallback | null; classes: string }

type HistoryBackProps = BackWayProps

const HistoryBack = ({ classes }: HistoryBackProps) => {
  const navigate = useNavigate()
  return (
    <Button
      tone={BUTTON_TONES.pill}
      icon="back"
      className={classes}
      onClick={() => void navigate(-1)}
    >
      <span className={styles.backLabel}>{BACK_BUTTON_COPY.back}</span>
    </Button>
  )
}

type FallbackBackProps = BackWayProps

const FallbackBack = ({ fallback, classes }: FallbackBackProps) =>
  fallback !== null && (
    <ButtonLink tone={BUTTON_TONES.pill} to={fallback.to} icon="back" className={classes}>
      <span className={styles.backLabel}>{fallback.label}</span>
    </ButtonLink>
  )

const NoBack = () => null

const BACK_VIEWS = {
  [BACK_WAYS.history]: HistoryBack,
  [BACK_WAYS.fallback]: FallbackBack,
  [BACK_WAYS.none]: NoBack,
} as const satisfies Record<BackWay, ComponentType<BackWayProps>>

type BackWayOfProps = { canGoBack: boolean; fallback: BackFallback | null }

const backWayOf = ({ canGoBack, fallback }: BackWayOfProps): BackWay => {
  if (canGoBack) return BACK_WAYS.history
  if (fallback) return BACK_WAYS.fallback
  return BACK_WAYS.none
}

type BackButtonProps = {
  fallback: BackFallback | null
  className?: string
}

type HasHomeButtonProps = { way: BackWay; fallback: BackFallback | null; pathname: string }

/** The Homes a way back may already lead to: raven's own, and the music mode's. */
const HOMES: ReadonlySet<string> = new Set([APP_PATHS.home, MUSIC_PATHS.root])

/** Whether a Home button stands beside the way back: not on Home, nor where the way back already goes to a Home. */
const hasHomeButton = ({ way, fallback, pathname }: HasHomeButtonProps): boolean => {
  if (pathname === APP_PATHS.home || way === BACK_WAYS.none) return false
  return way === BACK_WAYS.history || !HOMES.has(fallback?.to ?? APP_PATHS.home)
}

/**
 * A step back through the app's own history, as the browser's Back would, so
 * the page behind comes back scrolled where it was. A page opened straight
 * from its address has none: `fallback` names where it goes instead, and
 * with no fallback there is no button. On a phone it is the phone app's
 * plain Back, with a Home button beside it unless the way back already goes
 * Home. A page places the pair with `className`.
 */
export const BackButton = ({ fallback, className }: BackButtonProps) => {
  const canGoBack = useCanGoBack()
  const { pathname } = useLocation()
  const way = backWayOf({ canGoBack, fallback })
  const Way: ComponentType<BackWayProps> = BACK_VIEWS[way]
  return (
    <span className={classNames([styles.way, className])}>
      <Way fallback={fallback} classes={styles.back ?? ''} />
      {hasHomeButton({ way, fallback, pathname }) && (
        <ButtonLink
          tone={BUTTON_TONES.ghost}
          icon="home"
          to={APP_PATHS.home}
          className={styles.home}
          aria-label={COMMON_COPY.home}
        />
      )}
    </span>
  )
}
