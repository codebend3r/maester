import { Button, useCanGoBack, useKeyShortcut } from '@raven/ui'
import { type ComponentType, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { handled } from '@/desktop/handled'
import { PLAYER_MESSAGE_COPY } from '@/desktop/player/copy'
import styles from '@/pages/WatchPage/WatchPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'

/** Whether the player waits for the video or says why it will not play. */
const MESSAGE_KINDS = { waiting: 'waiting', refused: 'refused' } as const

type MessageKind = (typeof MESSAGE_KINDS)[keyof typeof MESSAGE_KINDS]

type MessageLineProps = { message: string | null }

const WaitingLine = () => <p aria-live="polite">{COMMON_COPY.loading}</p>

type RefusedLineProps = MessageLineProps

const RefusedLine = ({ message }: RefusedLineProps) => <p role="alert">{message}</p>

const MESSAGE_LINES = {
  [MESSAGE_KINDS.waiting]: WaitingLine,
  [MESSAGE_KINDS.refused]: RefusedLine,
} as const satisfies Record<MessageKind, ComponentType<MessageLineProps>>

type PlayerMessageProps = {
  message: string | null
  fallback: string
}

/**
 * Raven's place for a video that is not playing: waiting for it (a null message), or
 * saying why it will not. The player's routes sit outside the side menu and the window has no
 * Back of its own, so Back and Escape always lead out: to the page behind, or `fallback`.
 */
export const PlayerMessage = ({ message, fallback }: PlayerMessageProps) => {
  const navigate = useNavigate()
  const canGoBack = useCanGoBack()
  const leave = useCallback(
    () =>
      handled(Promise.resolve(canGoBack ? navigate(-1) : navigate(fallback, { replace: true }))),
    [canGoBack, navigate, fallback],
  )
  useKeyShortcut({ key: 'escape', onPress: leave })
  const isWaiting = message === null
  const Line = MESSAGE_LINES[isWaiting ? MESSAGE_KINDS.waiting : MESSAGE_KINDS.refused]
  return (
    <main className={styles.page} aria-busy={isWaiting}>
      <Line message={message} />
      <Button tone="pill" icon="back" className={styles.back} onClick={leave}>
        {PLAYER_MESSAGE_COPY.back}
      </Button>
    </main>
  )
}
