import type { SkipStep } from '@raven/core'
import { watchKeys } from '@raven/keys'
import { usePlayerPrefs } from '@raven/ui/headless'
import { useEffect, useRef } from 'react'

import type { TrackPicker, Transport } from '@/layouts/playerKit'
import { KEY_ANSWERS, type KeyAnswer, PLAYER_KEYS, keyAnswerOf } from '@/player/keyActions'

type UsePlayerKeysProps = {
  /** Null while there is nothing to drive; the keys then only leave. */
  transport: Transport | null
  subtitles: TrackPicker | null
  onBack: () => void
  /** Hears every key the player answers, before the answer, so the controls can show. */
  onPress: () => void
}

type AnswerProps = UsePlayerKeysProps & { answer: KeyAnswer }

/** Carries a key's answer out as the button for it would. */
const carryOut = ({ answer, transport, subtitles, onBack }: AnswerProps): void => {
  switch (answer.type) {
    case KEY_ANSWERS.togglePlay:
      transport?.onTogglePlay()
      return
    case KEY_ANSWERS.seek:
      transport?.onSeek(answer.to)
      return
    case KEY_ANSWERS.volume:
      usePlayerPrefs.getState().setVolume({ volume: answer.volume, muted: answer.isMuted })
      return
    case KEY_ANSWERS.subtitle:
      subtitles?.onChoose(answer.key)
      return
    case KEY_ANSWERS.leave:
      onBack()
      return
    default: {
      const unknown: never = answer
      return unknown
    }
  }
}

/**
 * The hardware keyboard drives the player as it drives the web's (`@raven/core`'s
 * `shortcutFor`), through `@raven/keys`, for as long as the chrome is on screen. One
 * subscription for the chrome's life reads the latest props, so a key always acts on the video
 * as it is now.
 */
export const usePlayerKeys = (props: UsePlayerKeysProps): void => {
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })
  useEffect(() => {
    let lastSkip: SkipStep | null = null
    return watchKeys({
      keys: PLAYER_KEYS,
      onKey: ({ key, isShift, isMeta }) => {
        const { transport, subtitles } = latest.current
        const { volume, muted } = usePlayerPrefs.getState()
        const answered = keyAnswerOf({
          // The native side registers no Ctrl or Alt command, so neither is ever held here.
          press: {
            key: isShift ? key.toUpperCase() : key,
            metaKey: isMeta,
            ctrlKey: false,
            altKey: false,
          },
          position: transport?.position ?? 0,
          duration: transport?.duration ?? null,
          volume,
          isMuted: muted,
          subtitles,
          lastSkip,
          now: Date.now(),
        })
        lastSkip = answered.lastSkip
        const { answer } = answered
        if (answer === null) return
        latest.current.onPress()
        carryOut({ ...latest.current, answer })
      },
    })
  }, [])
}
