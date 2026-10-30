import type { ComponentType } from 'react'
import { Button, ButtonLink, useCanGoBack } from '@raven/ui'
import { useNavigate } from 'react-router-dom'
import { BACK_BUTTON_COPY } from '@/components/BackButton/copy'
import styles from '@/components/BackButton/BackButton.module.scss'
import { COMMON_COPY } from '@/lib/copy'

/** Where a page goes back to when nothing of the app is behind it, and what it is called. */
export type BackFallback = { to: string; label: string }

/** The way back for a page that hangs off the home page. */
export const HOME = { to: '/', label: COMMON_COPY.home } as const satisfies BackFallback

/** Which way back there is: the app's own history, the fallback, or none. */
const BACK_WAYS = { history: 'history', fallback: 'fallback', none: 'none' } as const

type BackWay = (typeof BACK_WAYS)[keyof typeof BACK_WAYS]

type BackWayProps = { fallback: BackFallback | null; classes: string }

type HistoryBackProps = BackWayProps

const HistoryBack = ({ classes }: HistoryBackProps) => {
  const navigate = useNavigate()
  return (
    <Button tone="pill" icon="back" className={classes} onClick={() => void navigate(-1)}>
      <span className={styles.backLabel}>{BACK_BUTTON_COPY.back}</span>
    </Button>
  )
}

type FallbackBackProps = BackWayProps

const FallbackBack = ({ fallback, classes }: FallbackBackProps) =>
  fallback !== null && (
    <ButtonLink tone="pill" to={fallback.to} icon="back" className={classes}>
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

/**
 * A step back through the app's own history, as the browser's Back would, so
 * the page behind comes back scrolled where it was. A page opened straight
 * from its address has none: `fallback` names where it goes instead, and
 * with no fallback there is no button.
 */
export const BackButton = ({ fallback, className }: BackButtonProps) => {
  const canGoBack = useCanGoBack()
  const classes = [styles.back, className ?? ''].filter(Boolean).join(' ')
  const Way: ComponentType<BackWayProps> = BACK_VIEWS[backWayOf({ canGoBack, fallback })]
  return <Way fallback={fallback} classes={classes} />
}
