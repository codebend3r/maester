import { Button, useCanGoBack, useKeyShortcut } from '@raven/ui'
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { handled } from '@/desktop/handled'
import styles from '@/pages/WatchPage/WatchPage.module.scss'

/**
 * raven player's place for a video that is not playing: waiting for it (a null message), or
 * saying why it will not. The player's routes sit outside the side menu and the window has no
 * Back of its own, so Back and Escape always lead out: to the page behind, or `fallback`.
 */
export const PlayerMessage = ({
  message,
  fallback,
}: {
  message: string | null
  fallback: string
}) => {
  const navigate = useNavigate()
  const canGoBack = useCanGoBack()
  const leave = useCallback(
    () =>
      handled(Promise.resolve(canGoBack ? navigate(-1) : navigate(fallback, { replace: true }))),
    [canGoBack, navigate, fallback],
  )
  useKeyShortcut({ key: 'escape', onPress: leave })
  return (
    <main className={styles.page} aria-busy={message === null}>
      {message === null ? <p aria-live="polite">Loading</p> : <p role="alert">{message}</p>}
      <Button tone="pill" icon="back" className={styles.back} onClick={leave}>
        Back
      </Button>
    </main>
  )
}
