import type { EqGains } from '@raven/core'
import { type RefObject, useCallback, useEffect, useRef } from 'react'
import { type SoundGraph, soundGraph } from '@/components/AudioHost/soundGraph'

/** The `AudioContext` state a browser holds a context in until a gesture lets it run. */
const SUSPENDED: AudioContextState = 'suspended'

/** The gestures a browser lets a suspended context resume on. */
const GESTURE_EVENTS = ['pointerdown', 'keydown'] as const

/** Whether this browser has Web Audio at all. */
export const hasWebAudio = (): boolean => typeof AudioContext !== 'undefined'

type Routed = { context: AudioContext; graph: SoundGraph }

type UseSoundGraphProps = {
  elements: readonly RefObject<HTMLAudioElement | null>[]
  /** Whether the elements' sound goes through Web Audio; once it has, it always does. */
  isRouted: boolean
  gains: EqGains
}

type SoundRoute = {
  /** The graph, once a play has built it; null until then, and while nothing is routed. */
  graph: () => SoundGraph | null
  /** Builds the graph on the first play that needs it, and resumes a context the browser suspended. */
  wake: () => void
}

/**
 * The host's one `AudioContext` and graph. It is built on a play, not on
 * mount, since a browser keeps a context made before a gesture suspended,
 * and each element is routed once, as `createMediaElementSource` allows.
 */
export const useSoundGraph = ({ elements, isRouted, gains }: UseSoundGraphProps): SoundRoute => {
  const routed = useRef<Routed | null>(null)
  // Read when the graph is built, which happens in a play rather than when the gains change.
  const latestGains = useRef(gains)

  useEffect(() => {
    latestGains.current = gains
    routed.current?.graph.setEq(gains)
  }, [gains])

  useEffect(
    () => () => {
      routed.current?.context.close().catch(() => undefined)
      routed.current = null
    },
    [],
  )

  // A graph a play built with no gesture behind it (a media key, an advance, a fade) stays
  // suspended, its elements playing into silence, until the next gesture resumes it.
  useEffect(() => {
    if (!isRouted) return
    const resume = () => {
      const context = routed.current?.context
      if (context?.state === SUSPENDED) context.resume().catch(() => undefined)
    }
    GESTURE_EVENTS.forEach((name) => document.addEventListener(name, resume, { capture: true }))
    return () =>
      GESTURE_EVENTS.forEach((name) =>
        document.removeEventListener(name, resume, { capture: true }),
      )
  }, [isRouted])

  const graph = useCallback(() => routed.current?.graph ?? null, [])

  const wake = useCallback(() => {
    if (!isRouted || !hasWebAudio()) return
    const build = (): Routed | null => {
      const nodes = elements.flatMap((ref) => (ref.current ? [ref.current] : []))
      if (nodes.length !== elements.length) return null
      const context = new AudioContext()
      const built = soundGraph({ context, elements: nodes })
      built.setEq(latestGains.current)
      routed.current = { context, graph: built }
      return routed.current
    }
    const current = routed.current ?? build()
    if (current?.context.state !== SUSPENDED) return
    current.context.resume().catch(() => undefined)
  }, [elements, isRouted])

  return { graph, wake }
}
