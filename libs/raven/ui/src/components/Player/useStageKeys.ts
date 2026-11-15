import { KEYS, PLAYER_ACTIONS, type PlayerAction, shortcutFor } from '@raven/core'
import { type RefObject, useEffect, useEffectEvent } from 'react'
import type { HostActions } from '@/components/Player/PlayerServices'
import { OVERLAYS, type Overlay } from '@/components/Player/usePlayerActions'
import { isInForeignDialog, isTypingTarget } from '@/lib/keyboard'

const KEY_EVENTS = { down: 'keydown', up: 'keyup' } as const

const isControlTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && !!target.closest('button, a')

const isInDialog = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && !!target.closest('dialog')

/**
 * Whether a focused button or link answers the key itself: Enter anywhere,
 * Space only in a menu or dialog. On the bar Space plays or pauses, as
 * YouTube's does, rather than pressing the button clicked last, Full screen
 * among them.
 */
const isPressedByControl = (event: KeyboardEvent): boolean => {
  if (!isControlTarget(event.target)) return false
  if (event.key === KEYS.enter) return true
  return event.key === KEYS.space && isInDialog(event.target)
}

type UseStageKeysProps = {
  root: RefObject<HTMLDivElement | null>
  overlay: Overlay
  /** Whether the engine has a video info overlay for `i` to show. */
  canShowStats: boolean
  hostActions: HostActions | null
  /** Called on every key and host action, so the controls show. */
  wake: () => void
  act: (action: PlayerAction) => void
}

/**
 * The player's keyboard and its host's actions: each key the shortcuts name, and each action a
 * host sends (the desktop menu), goes to `act`, unless a form control, a focused button or a
 * host's own dialog has the key.
 */
export const useStageKeys = ({
  root,
  overlay,
  canShowStats,
  hostActions,
  wake,
  act,
}: UseStageKeysProps): void => {
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    // A host's dialog over the player keeps its keys, Escape included: they close it, not the player.
    if (isInForeignDialog({ target: event.target, root: root.current })) return
    wake()
    const action = shortcutFor(event)
    /*
     * Form controls keep their own keys (the radios' arrows, the volume
     * slider's); only Escape reaches past them, to close what they sit in.
     */
    const isEscape = action !== null && action.type === PLAYER_ACTIONS.escape
    if (isTypingTarget(event.target) && !isEscape) return
    if (isPressedByControl(event)) return
    if (!action) return
    // An engine without the video info overlay leaves `i` to the page.
    if (action.type === PLAYER_ACTIONS.toggleStats && !canShowStats) return
    // With the shortcut list open, the keys only close it.
    if (
      overlay === OVERLAYS.shortcuts &&
      action.type !== PLAYER_ACTIONS.escape &&
      action.type !== PLAYER_ACTIONS.showShortcuts
    ) {
      return
    }
    event.preventDefault()
    act(action)
  })
  // A button presses itself on Space's keyup, so the bar's are stopped there too.
  const onKeyUp = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== KEYS.space || !isControlTarget(event.target) || isInDialog(event.target)) {
      return
    }
    event.preventDefault()
  })
  useEffect(() => {
    window.addEventListener(KEY_EVENTS.down, onKey)
    window.addEventListener(KEY_EVENTS.up, onKeyUp)
    return () => {
      window.removeEventListener(KEY_EVENTS.down, onKey)
      window.removeEventListener(KEY_EVENTS.up, onKeyUp)
    }
  }, [])

  const onHostAction = useEffectEvent((action: PlayerAction) => {
    wake()
    act(action)
  })
  useEffect(() => hostActions?.subscribe(onHostAction) ?? undefined, [hostActions])
}
