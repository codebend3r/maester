import { Button, ButtonLink, useCanGoBack } from '@raven/ui'
import { useNavigate } from 'react-router-dom'
import styles from '@/components/BackButton/BackButton.module.scss'

/** Where a page goes back to when nothing of the app is behind it, and what it is called. */
export type BackFallback = { to: string; label: string }

/** The way back for a page that hangs off the home page. */
export const HOME = { to: '/', label: 'Home' } as const satisfies BackFallback

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
  const navigate = useNavigate()
  const canGoBack = useCanGoBack()
  const classes = [styles.back, className ?? ''].filter(Boolean).join(' ')
  if (canGoBack) {
    return (
      <Button tone="pill" icon="back" className={classes} onClick={() => void navigate(-1)}>
        <span className={styles.backLabel}>Back</span>
      </Button>
    )
  }
  if (!fallback) return null
  return (
    <ButtonLink tone="pill" to={fallback.to} icon="back" className={classes}>
      <span className={styles.backLabel}>{fallback.label}</span>
    </ButtonLink>
  )
}
